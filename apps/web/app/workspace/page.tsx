import { redirect } from "next/navigation";

/** Source-preview links resolve to the existing single workspace. */
export default function WorkspaceAlias() {
  redirect("/");
}
