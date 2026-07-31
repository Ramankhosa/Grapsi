// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { useReviewerSession as useSession } from '@/lib/reviewer-auth-client';
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";
import { toast } from "react-hot-toast";
import SectionSelector from "../../../../components/SectionSelector";
import RichTextEditor from "../../../../components/RichTextEditor";
import BudgetJustificationEditor from "../../../../components/BudgetJustificationEditor";
import ReviewerShell from "@/components/reviewer/ReviewerShell";
import { groupReviewerSections } from "@/lib/reviewer/sectionGrouping";

/**
 * Add a section that does not exist yet.
 *
 * Revising is no longer routed through here. This page used to carry the whole
 * revision flow *and* render its form twice in two byte-identical branches
 * (~550 duplicated lines), while its own copy of the section list duplicated
 * the workspace navigation. Revision now happens in place on the section page,
 * where the previous remarks are actually visible.
 */
export default function NewSection() {
  const { status } = useSession();
  const router = useRouter();
  const { id: callId } = router.query;

  const [call, setCall] = useState(null);
  const [sections, setSections] = useState([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [stage, setStage] = useState("idle"); // idle | saving | reviewing
  const [error, setError] = useState("");

  const [stagedAssets, setStagedAssets] = useState([]);
  const [assetUploading, setAssetUploading] = useState(false);
  const fileInputRef = useRef(null);

  const busy = stage !== "idle";

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    const load = async () => {
      if (!callId || status !== "authenticated") return;
      try {
        const [callRes, sectionsRes] = await Promise.all([
          axios.get(`/api/reviewer/calls/${callId}`),
          axios.get(`/api/reviewer/calls/${callId}/sections`),
        ]);
        setCall(callRes.data.call);
        setSections(sectionsRes.data.sections || []);
      } catch (err) {
        console.error("Error loading workspace:", err);
      }
    };
    load();
  }, [callId, status]);

  const existingTitles = groupReviewerSections(sections).map(group => group.title);
  const titleExists = existingTitles.some(
    existing => existing.toLowerCase() === title.trim().toLowerCase()
  );
  const isBudget = title.toLowerCase().includes("budget");
  const supportsAssets = ["method", "timeline", "budget"].some(k =>
    title.toLowerCase().includes(k)
  );

  const sectionType = () => {
    const lower = title.toLowerCase();
    if (lower.includes("method")) return "METHODOLOGY";
    if (lower.includes("timeline")) return "TIMELINE";
    return "BUDGET_JUSTIFICATION";
  };

  const handleUpload = async files => {
    if (!files?.length || !callId) return;
    const file = files[0];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (![".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(ext)) {
      toast.error("Use a PNG, JPG, WEBP or PDF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("project_id", String(callId));

    try {
      setAssetUploading(true);
      const res = await axios.post(`/api/reviewer/assets/upload`, form, { timeout: 30000 });
      const { asset_id, preview_url } = res.data || {};
      if (!asset_id) throw new Error("No asset id returned");
      setStagedAssets(prev => [...prev, { asset_id, preview_url, mime: file.type }]);
      toast.success("Attached");
    } catch (err) {
      toast.error(err?.response?.data?.error || "Upload failed.");
    } finally {
      setAssetUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async event => {
    event.preventDefault();

    if (!title.trim() || !content.trim()) {
      setError("Pick a section and add its text.");
      return;
    }

    let newSectionId = null;

    try {
      setError("");
      setStage("saving");
      const createRes = await axios.post(`/api/reviewer/calls/${callId}/sections`, {
        section_title: title,
        user_input: content,
      });
      newSectionId = createRes?.data?.section?.id;
      if (!newSectionId) throw new Error("Section was not created");

      if (stagedAssets.length > 0) {
        const type = sectionType();
        await Promise.allSettled(
          stagedAssets.map((asset, index) =>
            axios.post(`/api/reviewer/assets/link`, {
              review_version_id: newSectionId,
              section_type: type,
              asset_id: asset.asset_id,
              order: index,
            })
          )
        );
      }
    } catch (err) {
      console.error("Error creating section:", err);
      setError(err?.response?.data?.error || "Couldn't save this section. Your text is still here.");
      setStage("idle");
      return;
    }

    // Saved. A failed review must not strand the user or lose the draft.
    try {
      setStage("reviewing");
      await axios.post(`/api/reviewer/calls/${callId}/sections/${newSectionId}/review`);
      toast.success("Section reviewed");
    } catch (err) {
      toast.error(
        err?.response?.status === 429
          ? "Saved. The reviewer is rate limited — run the review in a minute."
          : "Saved, but the review failed. You can run it from the section page."
      );
    } finally {
      setStage("idle");
      router.push(`/reviewer/${callId}/section/${newSectionId}`);
    }
  };

  if (status === "loading") {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-64 w-full max-w-[900px] animate-pulse rounded-xl bg-nickel-100" />
      </div>
    );
  }

  return (
    <ReviewerShell
      call={call || { id: callId }}
      sections={sections}
      title="Add a section"
    >
      <form onSubmit={handleSubmit} className="nk-panel mx-auto max-w-[880px]">
        <div className="nk-panel-head">
          <div>
            <h2 className="nk-title">New section</h2>
            <p className="nk-sub mt-0.5">
              It will be reviewed against this call's rules as soon as you save.
            </p>
          </div>
          <Link href={`/reviewer/${callId}`} className="nk-btn-ghost nk-btn-sm">
            Cancel
          </Link>
        </div>

        <div className="space-y-6 p-5">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700"
            >
              {error}
            </div>
          )}

          <div>
            <label className="nk-label mb-1.5">Section</label>
            <SectionSelector onSelect={setTitle} usedSections={[]} />
            {title && (
              <p className="mt-2 text-[12.5px] text-nickel-600">
                Selected: <span className="font-medium text-nickel-900">{title}</span>
              </p>
            )}
            {titleExists && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-4 text-amber-800">
                You already have a “{title}”. Saving this creates a new version of it —
                to answer the last review instead, open that section and choose Revise.
              </p>
            )}
          </div>

          <div>
            <label className="nk-label mb-1.5">Text</label>
            {isBudget ? (
              <BudgetJustificationEditor
                value={content}
                onChange={setContent}
                readOnly={busy}
                placeholder="Paste your budget justification."
              />
            ) : (
              <RichTextEditor
                value={content}
                onChange={setContent}
                readOnly={busy}
                placeholder="Paste this section of your proposal."
              />
            )}
          </div>

          {supportsAssets && (
            <div>
              <label className="nk-label mb-1.5">Attachments (optional)</label>
              <p className="mb-2 text-[12.5px] text-nickel-500">
                Figures, Gantt charts or budget workbooks. The reviewer reads them
                alongside the text.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden"
                onChange={e => handleUpload(e.target.files)}
              />
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  handleUpload(e.dataTransfer?.files);
                }}
                className="rounded-lg border border-dashed border-nickel-300 bg-nickel-25 p-5 text-center"
              >
                <p className="text-[13px] text-nickel-600">
                  {assetUploading ? "Uploading…" : "Drop a file here"}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={assetUploading}
                  className="nk-btn-secondary nk-btn-sm mt-3"
                >
                  Choose a file
                </button>
              </div>

              {stagedAssets.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {stagedAssets.map(asset => (
                    <li
                      key={asset.asset_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-nickel-200 bg-white p-2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {asset.mime?.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.preview_url}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                          />
                        ) : (
                          <span className="nk-tile h-10 w-10 text-[10px]">PDF</span>
                        )}
                        <span className="truncate text-[13px] text-nickel-700">Attached</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setStagedAssets(prev => prev.filter(a => a.asset_id !== asset.asset_id))
                        }
                        className="nk-btn-ghost nk-btn-xs"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-nickel-200 pt-5">
            <Link href={`/reviewer/${callId}`} className="nk-btn-secondary nk-btn-sm">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={busy || !title.trim() || !content.trim()}
              className="nk-btn-primary nk-btn-sm"
            >
              {stage === "saving" ? "Saving…" : stage === "reviewing" ? "Reviewing…" : "Save and review"}
            </button>
          </div>
        </div>
      </form>
    </ReviewerShell>
  );
}
