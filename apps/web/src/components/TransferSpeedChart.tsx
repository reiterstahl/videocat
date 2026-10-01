import type { DownloadSpeedSample } from "../lib/app-types";

export function TransferSpeedChart({ samples }: { samples: DownloadSpeedSample[] }) {
  const width = 640;
  const height = 150;
  const chartSamples = samples.length > 1
    ? samples
    : samples.length === 1
      ? [{ ...samples[0], timestamp: samples[0].timestamp - 1 }, samples[0]]
      : [
          { timestamp: Date.now() - 1, bytesPerSecond: 0 },
          { timestamp: Date.now(), bytesPerSecond: 0 }
        ];
  const maxSpeed = Math.max(1, ...chartSamples.map((sample) => sample.bytesPerSecond));
  const points = chartSamples.map((sample, index) => {
    const x = chartSamples.length === 1 ? width : (index / (chartSamples.length - 1)) * width;
    const y = height - (sample.bytesPerSecond / maxSpeed) * (height - 14) - 7;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;

  return (
    <svg
      aria-label="Velocidad reciente de transferencia"
      className="transfer-speed-chart"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line className="transfer-chart-grid" x1="0" x2={width} y1={height * 0.25} y2={height * 0.25} />
      <line className="transfer-chart-grid" x1="0" x2={width} y1={height * 0.5} y2={height * 0.5} />
      <line className="transfer-chart-grid" x1="0" x2={width} y1={height * 0.75} y2={height * 0.75} />
      <polygon className="transfer-chart-area" points={areaPoints} />
      <polyline className="transfer-chart-line" points={points.join(" ")} />
    </svg>
  );
}
