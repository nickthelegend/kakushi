"use client";

import { useEffect, useState } from "react";

const KEY = "kakushi.referrer";

/** The referrer from a ?ref= link, remembered in this browser until it's confirmed. */
export function useStoredReferrer(): [string | null, (v: string | null) => void] {
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(location.search).get("ref");
      if (fromUrl && /^0x[0-9a-fA-F]{40}$/.test(fromUrl)) localStorage.setItem(KEY, fromUrl.toLowerCase());
      setRef(localStorage.getItem(KEY));
    } catch {
      setRef(null);
    }
  }, []);
  const set = (v: string | null) => {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch {}
    setRef(v);
  };
  return [ref, set];
}
