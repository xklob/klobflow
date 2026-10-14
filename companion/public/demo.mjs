export const defaults = {
  mode: "grid",
  led: true,
  threshold: 175,
  minLength: 0.22,
  cx: 0.5,
  cy: 0.5,
  scale: 0.32,
  rotation: 0,
  cubeDepth: 0.4,
  circleSeparation: 1,
  tolerance: 4,
  diagonals: true,
  trails: true,
  showGuide: true,
  symmetry: true,
  showFeedback: true,
  mirror: true,
  planeCorners: [],
  zoom: 0,
  facing: "front",
  fps: 60,
  timing: "tog-same",
  ratio: "1:1",
};
export function demoFrame(config, time) {
  const width = 960,
    height = 720,
    aspectX = width / height,
    aspectY = 1,
    r = config.scale,
    c = [config.cx * aspectX, config.cy];
  const rotation = (config.rotation * Math.PI) / 180;
  const point = (x, y) => [
    c[0] + r * (x * Math.cos(rotation) - y * Math.sin(rotation)),
    c[1] + r * (x * Math.sin(rotation) + y * Math.cos(rotation)),
  ];
  let lines = [],
    vertices = [],
    circles = [];
  const line = (a, b) => ({ a, b });
  if (config.mode === "grid") {
    for (let i = -1; i <= 1; i++) {
      lines.push(
        line(point(i, -1), point(i, 1)),
        line(point(-1, i), point(1, i)),
      );
      for (let j = -1; j <= 1; j++) vertices.push(point(i, j));
    }
    if (config.diagonals)
      lines.push(
        line(point(-1, -1), point(1, 1)),
        line(point(-1, 1), point(1, -1)),
      );
  } else if (config.mode === "cube") {
    for (const z of [-0.5, 0.5])
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        vertices.push(
          point(x + z * config.cubeDepth, y - z * config.cubeDepth),
        );
    for (let z = 0; z < 2; z++)
      for (let i = 0; i < 4; i++)
        lines.push(line(vertices[z * 4 + i], vertices[z * 4 + ((i + 1) % 4)]));
    for (let i = 0; i < 4; i++) lines.push(line(vertices[i], vertices[i + 4]));
  } else if (config.mode === "circles")
    circles = [-0.5, 0.5].map((i) => ({
      center: point(i * config.circleSeparation, 0),
      radius: r,
    }));
  const theta = time / 1600;
  const staffs = [0, 1].map((i) => {
    const angle = i ? Math.PI - theta : theta,
      center = [aspectX * (i ? 0.66 : 0.34), 0.5],
      v = [Math.cos(angle) * 0.23, Math.sin(angle) * 0.23];
    return {
      a: [center[0] - v[0], center[1] - v[1]],
      b: [center[0] + v[0], center[1] + v[1]],
      confidence: 1,
    };
  });
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const closestLine = (p, s) => {
    const dx = s.b[0] - s.a[0],
      dy = s.b[1] - s.a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (dx * dx + dy * dy),
        ),
      );
    return [s.a[0] + dx * t, s.a[1] + dy * t];
  };
  const target = (p) => {
    const options = config.mode === "circles" ? circles.map(s => {
      const d = distance(p, s.center), v = d > 1e-9 ? [(p[0] - s.center[0]) / d, (p[1] - s.center[1]) / d] : [1, 0];
      return [s.center[0] + v[0] * r, s.center[1] + v[1] * r];
    }) : config.mode === "cube" ? vertices : lines.map(s => closestLine(p, s));
    return options.sort((a, b) => distance(p, a) - distance(p, b))[0];
  };
  const error = (p) => distance(p, target(p));
  const feedback = config.mode === "free" ? [] : staffs.flatMap(s => [s.a, s.b].map(tip => {
    const dest = target(tip), value = distance(tip, dest) / (2 * r) * 100;
    return { tip, target: dest, error: value, onTarget: value <= config.tolerance };
  }));
  const deviation =
    config.mode === "free"
      ? null
      : (Math.sqrt(
          staffs
            .flatMap((s) => [s.a, s.b])
            .reduce((s, p) => s + error(p) ** 2, 0) / 4,
        ) /
          (2 * r)) *
        100;
  return {
    time,
    width,
    height,
    staffs,
    feedback,
    config,
    currentConfig: config,
    guide: {
      lines,
      vertices,
      circles,
      center: c,
      span: 2 * r,
      aspectX,
      aspectY,
    },
    metrics: {
      deviation,
      angle: null,
      symmetry: null,
      steadiness: null,
      coverage: 100,
    },
    source: "demo",
    analysisFps: 30,
    status: "Generated motion · preview of practice guides",
    recording: false,
    cameraReady: false,
  };
}
