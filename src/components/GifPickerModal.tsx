'use client';

import GifPicker from '@/components/GifPicker';

interface Props {
  onGifSelect: (gifUrl: string) => void;
  onClose: () => void;
  title?: string;
}

export default function GifPickerModal({ onGifSelect, onClose, title = 'Choose a GIF' }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg flex flex-col overflow-hidden modal-sheet-bottom"
        style={{ height: 'min(70dvh, 520px)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <GifPicker
          variant="modal"
          onGifSelect={onGifSelect}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
