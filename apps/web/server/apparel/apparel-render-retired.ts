import { ApiRouteError } from "@/server/api-error";

export function apparelRenderRetired() {
  return new ApiRouteError({ code: "bad_request", status: 410, retryable: false,
    message: "服装固定排版已停用，请前往生图工作台使用提示词生图。", });
}
