import { Gateway } from "@/components/gateway";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return <Gateway route={path || []} />;
}
