'use client';

// Org Pages R2 (Sep 8 2026): the bubble card is now the house component at
// components/bubbles/BubbleCard. This shim keeps VitalsTab unchanged for
// one round; R3 retires it.
export { default } from '@/components/bubbles/BubbleCard';
