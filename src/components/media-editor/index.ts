/**
 * Public entry for the media editor. Always import from here — the modal is
 * lazy-loaded (react-easy-crop + the render pipeline stay out of every
 * page's initial JS; house pattern, same as EmojiPickerButton).
 */

import dynamic from 'next/dynamic';

export const MediaEditor = dynamic(() => import('./MediaEditorModal'), { ssr: false });
export type { MediaEditorModalProps } from './MediaEditorModal';
