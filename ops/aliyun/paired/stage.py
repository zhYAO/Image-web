"""Root-private backend artifact preparation, never activation.

Uses the unchanged layer adapter's transport, target, closure and native gates.
Caller holds the shared deploy.lock. No current/previous/run-sequence writer is
called. This deliberate entrypoint avoids intercepting legacy.activate halfway
through an ordinary deploy or treating a fake DB version as compatible.
"""
import os
from pathlib import Path
import tempfile


def pointers(root):
    result={}
    for name in ('current','previous','last-deployment-run'):
        path=root/name
        if not os.path.lexists(path):result[name]=None
        elif path.is_symlink():result[name]=('link',os.readlink(path))
        elif path.is_file():result[name]=('file',path.read_bytes())
        else:raise ValueError('Uncertain deployment pointer/sequence')
    return result


def prepare(bridge,adapter,sha,outer_sha,manifest_sha):
    if not bridge.HEX40.fullmatch(sha) or not bridge.HEX64.fullmatch(outer_sha) or not bridge.HEX64.fullmatch(manifest_sha):raise ValueError('Exact approved artifact digests required')
    before=pointers(adapter.root)
    adapter.current_target();adapter.target_check();adapter.service_check()
    for name in ('layer-store','layer-cache','releases'):adapter.managed_directory(adapter.root/name)
    mutable=adapter.layers.ancestors_safe(adapter.root/'cache')
    if not mutable.is_dir():raise ValueError('Existing managed mutable cache required')
    with tempfile.TemporaryDirectory(prefix='.pair-incoming-',dir=adapter.root) as incoming:
        protected=Path(incoming);archive=protected/'transport.tgz'
        bridge.copy_incoming(adapter.root,sha,archive,outer_sha)
        manifest,body,provided=bridge.unpack_outer(archive,protected/'unpacked',sha,manifest_sha,adapter.layers)
        adapter.validate_manifest(manifest,sha);adapter.target_check(manifest)
        store=adapter.root/'layer-store'
        adapter.merge_transport(protected/'unpacked',manifest,body,provided,sha,manifest_sha)
        entries=[]
        for kind in ('code','runtime'):
            index=adapter.layers.parse(adapter.layers.read_regular(store/manifest['layers'][kind]['index']))
            for entry in index['entries']:
                name=entry['path']
                if name in ('.release-sha','.archive-sha256','.manifest-sha256','.runtime-assets.env') or name=='apps/web/.next/cache' or name.startswith('apps/web/.next/cache/'):raise ValueError('Incoming claims reserved adapter/cache path')
            entries.extend(index['entries'])
        parent=Path(tempfile.mkdtemp(prefix='.pair-candidate-',dir=adapter.root/'releases'));parent.chmod(0o755)
        candidate=parent/'app'
        try:
            assembled=adapter.layers.assemble(store/f'releases/{sha}.json',store,candidate,adapter.root/'layer-cache',manifest_sha,True)
            adapter.cache_ownership(assembled)
            (candidate/'apps/web/.next/cache').symlink_to(mutable,target_is_directory=True)
            adapter.validate_candidate(candidate,manifest,sha,entries)
            adapter.metadata(candidate,sha,outer_sha,manifest_sha,assembled['environment'])
            adapter.native_check(candidate,assembled['environment'])
            target=adapter.root/'releases'/sha;reused=os.path.lexists(target)
            if reused:
                if target.is_symlink():raise ValueError('Existing release symlink rejected')
                adapter.compare_retained(target,candidate)
            else:adapter.layers.rename_no_replace(candidate,target)
        finally:adapter.layers.remove_owned(parent)
    adapter.verify_store_closure(manifest,body,sha,manifest_sha);adapter.recheck_caches(manifest)
    if pointers(adapter.root)!=before:raise ValueError('Pointers/sequence changed during preparation; reconcile')
    return {'backendRelease':sha,'manifestSha256':manifest_sha,'activated':False,'reused':reused,'productionReady':False}
