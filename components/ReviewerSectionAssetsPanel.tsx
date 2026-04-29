// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

type SectionAssetType = 'METHODOLOGY' | 'TIMELINE' | 'BUDGET_JUSTIFICATION';

type LinkedItem = {
  link_id: string;
  asset_id: string;
  mime: string;
  preview_url: string;
  order: number;
  attach_in_prompt: boolean;
};

interface Props {
  reviewVersionId: string; // reviewer_sections.id
  sectionType: SectionAssetType;
  projectId: string;
}

export default function ReviewerSectionAssetsPanel({ reviewVersionId, sectionType, projectId }: Props) {
  const [items, setItems] = useState<LinkedItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!reviewVersionId) return;
    const res = await axios.get(`/api/reviewer/assets/linked`, { params: { review_version_id: reviewVersionId } });
    setItems((res.data?.[sectionType] || []) as LinkedItem[]);
  }, [reviewVersionId, sectionType]);

  useEffect(() => { load(); }, [load]);

  const onSelectFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const form = new FormData();
    form.append('file', file);
    form.append('project_id', projectId);
    form.append('review_version_id', reviewVersionId);
    form.append('section_type', sectionType);
    setUploading(true);
    try {
      await axios.post(`/api/reviewer/assets/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } finally {
      setUploading(false);
    }
  };

  const toggleAttach = async (linkId: string, next: boolean) => {
    await axios.patch(`/api/reviewer/assets/link/${linkId}`, { attach_in_prompt: next });
    await load();
  };

  const move = async (linkId: string, direction: -1 | 1) => {
    const current = items.find(i => i.link_id === linkId);
    if (!current) return;
    const newOrder = Math.max(0, current.order + direction);
    await axios.patch(`/api/reviewer/assets/link/${linkId}`, { order: newOrder });
    await load();
  };

  const unlink = async (linkId: string) => {
    await axios.delete(`/api/reviewer/assets/link/${linkId}`);
    await load();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt?.files) onSelectFiles(dt.files);
  };

  return (
    <div className="border rounded-md p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-gray-800">Assets</div>
        <button
          onClick={() => inputRef.current?.click()}
          className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          disabled={uploading}
        >Select file</button>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={e => onSelectFiles(e.target.files)} />
      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded p-4 text-center text-gray-500 mb-3"
      >{uploading ? 'Uploading...' : 'Drag & drop PNG/JPG/WEBP/PDF here'}</div>

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.link_id} className="flex items-center justify-between bg-gray-50 rounded p-2">
            <div className="flex items-center space-x-3">
              {item.mime.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview_url} alt="preview" className="w-12 h-12 object-cover rounded" />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center bg-white border rounded text-xs">PDF</div>
              )}
              <div className="text-sm text-gray-700">{item.mime}</div>
            </div>
            <div className="flex items-center space-x-2">
              <label className="text-xs text-gray-700 flex items-center space-x-1">
                <input type="checkbox" checked={item.attach_in_prompt} onChange={e => toggleAttach(item.link_id, e.target.checked)} />
                <span>Attach in prompt</span>
              </label>
              <button className="text-xs px-2 py-1 bg-gray-100 rounded" onClick={() => move(item.link_id, -1)}>Up</button>
              <button className="text-xs px-2 py-1 bg-gray-100 rounded" onClick={() => move(item.link_id, 1)}>Down</button>
              <button className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded" onClick={() => unlink(item.link_id)}>Remove</button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-sm text-gray-500">No assets linked yet.</div>
        )}
      </div>
    </div>
  );
}



