import { Console } from "@/components/console";
import { loadBundles } from "@/lib/runs";

export const dynamic = "force-static";

export default function HomePage() {
  const bundles = loadBundles();
  return <Console bundles={bundles} />;
}
