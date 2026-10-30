import type { WorkspaceGateway } from '@zimage/domain';
import { HttpWorkspaceGateway } from '../../../web/gateways/http-workspace-gateway';

let gateway: HttpWorkspaceGateway | undefined;
export function getWorkspaceGateway(): WorkspaceGateway { return gateway ??= new HttpWorkspaceGateway(); }
export function clearWorkspaceAssetCaches() { gateway?.clearAssetCaches(); gateway = undefined; }
