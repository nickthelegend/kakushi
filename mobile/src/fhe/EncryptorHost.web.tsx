// Expo web: the same encryptor page in a sandboxed, hidden iframe (postMessage both ways).
import React, { useEffect, useRef } from "react";
import { ENCRYPTOR_HTML } from "./encryptorHtml.generated";
import { encryptor } from "./bridge";

export function EncryptorHost() {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.source && ev.source === ref.current?.contentWindow && typeof ev.data === "string") encryptor.receive(ev.data);
    };
    window.addEventListener("message", onMsg);
    encryptor.attach((json) => ref.current?.contentWindow?.postMessage(json, "*"));
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return React.createElement("iframe", {
    ref,
    title: "fhish-encryptor",
    sandbox: "allow-scripts",
    srcDoc: ENCRYPTOR_HTML,
    style: { position: "absolute", width: 1, height: 1, opacity: 0, border: 0, left: -10, top: -10 },
  });
}
