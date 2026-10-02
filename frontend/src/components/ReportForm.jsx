import { useState } from "react";
import { api } from "../lib/api";

/* Manual intake (spec 4.1). Feeds the same pipeline as the social and weather
   channels, so a typed report is triaged and deduplicated identically. */
export default function ReportForm({ center, onSubmitted, onError }) {
  const [text, setText] = useState("");
  const [lat, setLat] = useState(center?.[0]?.toFixed(4) ?? "30.7333");
  const [lng, setLng] = useState(center?.[1]?.toFixed(4) ?? "76.7794");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit() {
    if (text.trim().length < 3) {
      onError?.("Describe what is happening before filing the report.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createReport({
        text: text.trim(),
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address: address || null,
        source: "manual",
      });
      setResult(res);
      setText("");
      onSubmitted?.(res);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div className="field">
        <label className="eyebrow">What is happening</label>
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Water rising fast on the market road, shops are flooding"
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="eyebrow">Latitude</label>
          <input className="input num" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="eyebrow">Longitude</label>
          <input className="input num" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label className="eyebrow">Address (optional)</label>
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <button className="btn primary" onClick={submit} disabled={busy}>
        {busy ? "Filing…" : "File report"}
      </button>

      {result && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-2)" }}>
          <div className="eyebrow">Triage result</div>
          <div style={{ marginTop: 4 }}>
            {result.merged ? (
              <>
                Merged into incident <b>#{result.incident_id}</b> — the agent decided this describes an
                event already in the queue.
              </>
            ) : (
              <>
                Opened incident <b>#{result.incident_id}</b> as{" "}
                <b>{result.triage.type.replace(/_/g, " ")}</b>, severity {result.triage.severity},{" "}
                {Math.round(result.triage.confidence * 100)}% confidence.
              </>
            )}
          </div>
          <div className="hint">{result.triage.reasoning}</div>
        </div>
      )}
    </div>
  );
}
