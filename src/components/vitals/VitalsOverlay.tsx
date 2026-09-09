'use client';

// Org Pages R2 (Sep 8 2026): the "larger window" is now the house
// component at components/bubbles/LargerWindow. This shim keeps the
// vitals call sites unchanged for one round; R3 retires it.
export { default } from '@/components/bubbles/LargerWindow';
