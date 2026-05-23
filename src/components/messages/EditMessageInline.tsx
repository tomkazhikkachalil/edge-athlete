'use client';

import { useEffect, useRef, useState } from 'react';

interface UpdatedFields {
  content: string;
  edited_at: string;
}

interface Props {
  conversationId: string;
  messageId: string;
  initialContent: string;
  isOwn: boolean;
  onCancel: () => void;
  onUpdated: (fields: UpdatedFields) => void;
}

export default function EditMessageInline({
  conversationId,
  messageId,
  initialContent,
  isOwn,
  onCancel,
  onUpdated,
}: Props) {
  const [text, setText] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Message cannot be empty');
      return;
    }
    if (trimmed === initialContent.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(
        `/api/messages/${conversationId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to edit message');
      }
      const data = await res.json();
      const m = data.message as { content: string; edited_at: string };
      onUpdated({ content: m.content, edited_at: m.edited_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit message');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const bubbleBase = isOwn
    ? 'bg-blue-600 text-white rounded-l-2xl rounded-tr-2xl'
    : 'bg-gray-100 text-gray-900 rounded-r-2xl rounded-tl-2xl';

  return (
    <div className={`px-3 py-2 ${bubbleBase} max-w-full ea-edit-pulse`}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={saving}
        rows={1}
        className={`w-full resize-none bg-transparent outline-none text-sm placeholder-white/60 ${
          isOwn ? 'text-white' : 'text-gray-900'
        }`}
        style={{ minHeight: 24, maxHeight: 160 }}
      />
      {error && (
        <p className={`text-xs mt-1 ${isOwn ? 'text-red-100' : 'text-red-600'}`}>{error}</p>
      )}
      <div className="flex items-center justify-end gap-2 mt-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={`text-xs px-2 py-1 rounded-md transition-colors ${
            isOwn
              ? 'text-white/80 hover:bg-white/10'
              : 'text-gray-500 hover:bg-gray-200'
          } disabled:opacity-50`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !text.trim()}
          className={`text-xs px-3 py-1 rounded-md font-semibold transition-colors ${
            isOwn
              ? 'bg-white text-blue-700 hover:bg-blue-50'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
