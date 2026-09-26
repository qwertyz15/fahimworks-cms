import type { Metadata } from "next";
import { AddContentWizard } from "@/components/content/add-content-wizard";
import { PageHeader } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Add content" };

export default async function AddContentPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Add content" description="Import a blog post, tutorial, article or project page you wrote." />
      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {["Analyze URL", "Verify ownership", "Automatic extraction", "Review & publish"].map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded-full border text-[10px] font-medium">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <AddContentWizard />
    </div>
  );
}
