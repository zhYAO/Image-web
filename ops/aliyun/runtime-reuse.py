"""Prepare runtime bytes for a new isolated candidate. No activation or install."""
import hashlib,importlib.util,json,os,stat
from pathlib import Path

def sibling(name,alias):
    spec=importlib.util.spec_from_file_location(alias,Path(__file__).with_name(name))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

layers=sibling('three-layer-release.py','reuse_original_layer_tools')
CONFIG_SOURCES={'apps/web/next.config.ts','apps/web/build/static-assets-config.mjs'}

def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def validate_reuse_bindings(business,retained):
    try:
        source,build=business['source'],business['build']
        fingerprint=retained['configFingerprint']
        config=source['configSources']
        if (not isinstance(config,dict) or set(config)!=CONFIG_SOURCES
                or not isinstance(build['dependencyResolution'],dict)
                or build['dependencyResolution'].get('output')!='standalone'):
            raise ValueError('Incomplete runtime reuse metadata')
        pairs=[
            ('lock',source['lockSha256'],retained['lockSha256']),
            ('config',config,fingerprint['sources']),
            ('resolution',build['dependencyResolution'],fingerprint['dependencyResolution']),
            ('assets',build['assetsVersion'],retained['assetsVersion']),
        ]
        for label,actual,expected in pairs:
            if encoded(actual)!=encoded(expected):
                raise ValueError('Runtime reuse '+label+' binding changed')
        if (not layers.SHA.fullmatch(source['lockSha256'])
                or not layers.SHA.fullmatch(build['assetsVersion'])
                or any(not isinstance(v,str)or not layers.SHA.fullmatch(v)for v in config.values())):
            raise ValueError('Invalid runtime reuse digest')
    except (KeyError,TypeError,AttributeError)as exc:
        raise ValueError('Incomplete runtime reuse metadata')from exc

def verify_graph(root,entries,readonly=False,label='candidate',require_link_targets=True):
    root=Path(root);entries=list(entries)
    layers.verify_tree(root,entries,readonly=readonly,label=label)
    for e in entries:
        p=root/e['path'];info=p.lstat()
        if e['type']=='file':
            expected=(0o555 if e['mode']&0o111 else 0o444)if readonly else e['mode']
            if stat.S_IMODE(info.st_mode)!=expected:
                raise ValueError(label+' indexed file permission mismatch')
        elif require_link_targets:
            try:target=p.resolve(strict=True)
            except (OSError,RuntimeError)as exc:
                raise ValueError(label+' link target is missing or cyclic')from exc
            if not target.is_relative_to(root.resolve()):
                raise ValueError(label+' link target escapes candidate')

def populate_runtime(cache,entries,destination,business_entries=()):
    cache=layers.ancestors_safe(Path(cache).absolute())
    destination=layers.ancestors_safe(Path(destination).absolute())
    if destination==cache or destination.is_relative_to(cache)or cache.is_relative_to(destination):
        raise ValueError('Runtime source and output must be disjoint')
    entries=list(entries);business_entries=list(business_entries)
    layers.validate_entries(entries);layers.validate_entries(business_entries)
    if any(layers.classify(e['path'])!='runtime'for e in entries):
        raise ValueError('Business member in runtime index')
    if any(layers.classify(e['path'])!='code'for e in business_entries):
        raise ValueError('Non-business member in business staging')
    if any(any(p.startswith('.env')or p in{'.npmrc','.netrc','.ssh'}for p in Path(e['path']).parts)for e in entries):
        raise ValueError('Credential path in runtime')
    layers.validate_entries(business_entries+entries)
    verify_graph(cache,entries,readonly=True,label='immutable runtime',require_link_targets=False)
    verify_graph(destination,business_entries,label='business staging')
    for e in entries:
        target=destination/e['path'];layers.ancestors_safe(target.parent)
        if os.path.lexists(target):
            raise ValueError('Runtime would overwrite an existing candidate member')
    links=[]
    for e in entries:
        target=destination/e['path'];layers.directory(target.parent)
        if e['type']=='symlink':
            links.append((target,e['target']));continue
        body=layers.read_regular(cache/e['path'])
        if len(body)!=e['bytes']or hashlib.sha256(body).hexdigest()!=e['sha256']:
            raise ValueError('Runtime changed during copy')
        with target.open('xb')as output:output.write(body)
        target.chmod(e['mode'])
    layers.create_links(destination,links)
    verify_graph(destination,business_entries+entries,label='combined candidate')
    return {'runtimeEntries':len(entries),'runtimeBytes':sum(e.get('bytes',0)for e in entries),
            'sourceCacheModified':False,'graphVerified':True,'productionReady':False}
