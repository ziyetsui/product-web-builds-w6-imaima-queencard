import { redirect } from "next/navigation";

export default async function GeneratedTaskCompatibilityPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  redirect(`/generated?taskId=${encodeURIComponent(taskId)}`);
}
