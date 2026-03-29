'use client';

import { useState, useEffect } from 'react';

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const onResize = () => {
      const offset = window.innerHeight - viewport.height;
      setKeyboardHeight(Math.max(0, offset));
    };

    viewport.addEventListener('resize', onResize);
    viewport.addEventListener('scroll', onResize);
    return () => {
      viewport.removeEventListener('resize', onResize);
      viewport.removeEventListener('scroll', onResize);
    };
  }, []);

  return keyboardHeight;
}
