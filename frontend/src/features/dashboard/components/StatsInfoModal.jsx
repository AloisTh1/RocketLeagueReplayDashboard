import { Info } from "lucide-react";

function splitDocSections(text) {
  const source = String(text || "").trim();
  if (!source) return [];
  const normalized = source.replace(/\s+/g, " ").trim();
  const labelMap = [
    { label: "What it means", patterns: ["Finishing and shot-generation view.", "Prevention view.", "Cooperation view.", "Composite influence view.", "Situational view.", "Category:", "Derived metric."] },
    { label: "Formula", patterns: ["Formula:"] },
    { label: "Team", patterns: ["Team scope ->", "Team scope =", "Team metric:"] },
    { label: "Player", patterns: ["Player scope ->", "Player scope =", "Player metric:"] },
    { label: "Display", patterns: ["Display rule:"] },
    { label: "Example", patterns: ["Extract:", "Bucket format:", "Delta =", "Uses tracked-player replay rows", "Uses all scoped matches."] },
  ];

  const markers = [];
  labelMap.forEach((entry) => {
    entry.patterns.forEach((pattern) => {
      let startAt = 0;
      while (startAt < normalized.length) {
        const idx = normalized.indexOf(pattern, startAt);
        if (idx === -1) break;
        markers.push({ idx, label: entry.label, pattern });
        startAt = idx + pattern.length;
      }
    });
  });

  if (!markers.length) {
    return [{ label: "Details", text: normalized }];
  }

  markers.sort((a, b) => a.idx - b.idx);
  const uniqueMarkers = markers.filter((marker, index) => index === 0 || marker.idx !== markers[index - 1].idx);
  const sections = [];

  uniqueMarkers.forEach((marker, index) => {
    const nextIdx = index + 1 < uniqueMarkers.length ? uniqueMarkers[index + 1].idx : normalized.length;
    let chunk = normalized.slice(marker.idx, nextIdx).trim();
    if (!chunk) return;
    if (marker.pattern.endsWith(":")) {
      chunk = chunk.slice(marker.pattern.length).trim();
    } else if (chunk.startsWith(marker.pattern)) {
      chunk = chunk.slice(marker.pattern.length).trim();
    }
    if (!chunk) return;
    sections.push({ label: marker.label, text: chunk });
  });

  if (uniqueMarkers[0].idx > 0) {
    const lead = normalized.slice(0, uniqueMarkers[0].idx).trim();
    if (lead) sections.unshift({ label: "What it means", text: lead });
  }

  return sections.length ? sections : [{ label: "Details", text: normalized }];
}

export function StatsInfoModal({ open, onClose, statsInfoTree }) {
  if (!open) return null;

  return (
    <div
      className="stats-info-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Stats info"
      onClick={onClose}
    >
      <section className="stats-info-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <Info size={18} /> Stats Info
          <span className="metric-scope-pill team" title="Documentation scope of each section.">Glossary</span>
        </div>
        <p className="status">
          Live glossary for the current view. Each row shows metric name and exact formula/source fields with a sample data extract.
        </p>
        <div className="stats-info-tree">
          {statsInfoTree.map((scopeNode) => (
            <details key={scopeNode.scope} className="stats-tree-scope" open>
              <summary>{scopeNode.scope}</summary>
              <div className="stats-tree-body">
                {scopeNode.sections.map((section) => (
                  <details key={`${scopeNode.scope}-${section.title}`} className="stats-tree-section">
                    <summary>{section.title}</summary>
                    <div className="stats-tree-body">
                      {section.groups.map((groupNode) => (
                        <details key={`${section.title}-${groupNode.group}`} className="stats-tree-group">
                          <summary>{groupNode.group}</summary>
                          <div className="stats-info-rows">
                            {groupNode.metrics.map((metric) => (
                              <div key={`${section.title}-${groupNode.group}-${metric.name}`} className="stats-info-row">
                                <div className="stats-info-name">{metric.name}</div>
                                <div className="stats-info-desc">
                                  {splitDocSections(metric.desc).map((part, index) => (
                                    <div key={`${metric.name}-${part.label}-${index}`} className="stats-info-part">
                                      <span className="stats-info-part-label">{part.label}</span>
                                      <span className="stats-info-part-text">{part.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
