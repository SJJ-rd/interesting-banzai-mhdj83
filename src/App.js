import React, { useEffect, useRef, useState, useMemo } from "react";

// --- 核心工具函數：檢查線段相交並返回交點 ---
// 修正：將此函數從 getVisualPoints 移出，讓 handleMouseUp 也能呼叫 [cite: 34-38, 248, 253]
const checkIntersect = (p1, p2, p3, p4, isTrimMode = false) => {
  if (!p1 || !p2 || !p3 || !p4) return null;
  const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(den) < 1e-10) return null; // 平行

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / den;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / den;

  // 檢查交點是否在兩條線段的範圍內 [cite: 37]
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: p1.x + ua * (p2.x - p1.x),
      y: p1.y + ua * (p2.y - p1.y),
    };
  }
  return null;
};

const CncWorkspace = () => {
  const [mode, setMode] = useState("DRAW_LINE");
  const [lineMode, setLineMode] = useState("G01");
  const [arcSubMode, setArcSubMode] = useState("SER");
  const [circleSubMode, setCircleSubMode] = useState("CEN");
  const [paths, setPaths] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedPathId, setSelectedPathId] = useState(null);
  const [isInner, setIsInner] = useState(false);
  const [isOrtho, setIsOrtho] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.5);
  const [offsetDist, setOffsetDist] = useState(2.0);
  const [chamferType, setChamferType] = useState("c");
  const [chamferVal, setChamferVal] = useState(2.0);
  const [toolConfig, setToolConfig] = useState({ code: "0101", r: 0.8, angle: 55, color: "#00FFFF" });
  const [stock, setStock] = useState({ od: 80, id: 0, length: 120, face: 2.0 });
  const [cam, setCam] = useState({ vc: 200, g50: 2500, feed: 0.2, doc: 2.0, safeDist: 2.0, allowX: 0.5, allowZ: 0.1 });
  const [gcode, setGcode] = useState("");

  const canvasRef = useRef(null);
  const cameraRef = useRef({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2, zoom: 1.5 });
  const interactionRef = useRef({
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    continuous: false,
    currentPt: { x: 0, y: 0 },
    isSnapped: false,
    trimPath: [],
    circleStart: null,
    tangentCircle: null,
    arcPts: [],
    sim: { active: false, progress: 0, pts: [] },
  });

  const saveState = () => setHistory((prev) => [...prev.slice(-29), JSON.parse(JSON.stringify(paths))]);

  const handleUndo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const newH = [...prev];
      setPaths(newH.pop());
      return newH;
    });
    interactionRef.current.continuous = false;
  };

  // --- 幾何計算引擎 ---
  const getVisualPoints = (pts) => {
    if (!pts || !Array.isArray(pts)) return [];
    let res = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined") continue;

      if ((pt.c > 0 || pt.r > 0) && i > 0 && i < pts.length - 1) {
        const p = pts[i - 1], n = pts[i + 1];
        if (!p || !n) { res.push(pt); continue; }
        const v1 = { x: p.x - pt.x, y: p.y - pt.y }, v2 = { x: n.x - pt.x, y: n.y - pt.y };
        const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
        if (l1 < 0.001 || l2 < 0.001) { res.push(pt); continue; }
        v1.x /= l1; v1.y /= l1; v2.x /= l2; v2.y /= l2;

        if (pt.c > 0) {
          const c = parseFloat(pt.c);
          res.push({ ...pt, x: pt.x + v1.x * c, y: pt.y + v1.y * c });
          res.push({ x: pt.x + v2.x * c, y: pt.y + v2.y * c, type: "G01" });
        } else if (pt.r > 0) {
          const r = parseFloat(pt.r);
          const dot = v1.x * v2.x + v1.y * v2.y;
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          const d = r / Math.tan(angle / 2);
          const pA = { x: pt.x + v1.x * d, y: pt.y + v1.y * d, type: pt.type };
          const ccw = v1.x * v2.y - v1.y * v2.x > 0;
          let nx = -v1.y, ny = v1.x;
          if (nx * v2.x + ny * v2.y < 0) { nx *= -1; ny *= -1; }
          const cx = pA.x + nx * r, cy = pA.y + ny * r;
          const pB_x = pt.x + v2.x * d, pB_y = pt.y + v2.y * d;
          res.push(pA, {
            x: pB_x, y: pB_y, type: "arc", radius: r, ccw, cx, cy,
            startAngle: Math.atan2(pA.y - cy, pA.x - cx),
            endAngle: Math.atan2(pB_y - cy, pB_x - cx),
          });
        }
      } else res.push({ ...pt });
    }
    return res;
  };

  const visualPaths = useMemo(() => paths.map((p) => ({ ...p, points: getVisualPoints(p.points) })), [paths]);
  const activePath = useMemo(() => paths.find((p) => p.id === selectedPathId) || paths[paths.length - 1], [paths, selectedPathId]);

  // --- 事件處理與繪製渲染 (省略重複的部分以節省空間，但確保結構正確) ---
  // ... 請保留原有的 useEffect 渲染邏輯、handleMouseDown、handleMouseMove ...

  const handleMouseUp = () => {
    if (mode === "TRIM" && interactionRef.current.trimPath.length > 1) {
      saveState();
      const tPath = interactionRef.current.trimPath;
      setPaths((prev) => {
        const allSegs = [];
        prev.forEach((path) => {
          if (path.points)
            for (let i = 0; i < path.points.length - 1; i++)
              if (path.points[i] && path.points[i + 1])
                allSegs.push({ A: path.points[i], B: path.points[i + 1] });
        });

        let newPaths = [];
        prev.forEach((path) => {
          if (!path.points) return;
          let cur = [];
          for (let i = 0; i < path.points.length - 1; i++) {
            const p1 = path.points[i], p2 = path.points[i + 1];
            if (!p1 || !p2) continue;
            let inters = [];
            // 現在這裡可以正確呼叫組件層級的 checkIntersect [cite: 248]
            allSegs.forEach((seg) => {
              const I = checkIntersect(p1, p2, seg.A, seg.B, false);
              if (I) inters.push(I);
            });
            inters.sort((a, b) => Math.hypot(a.x - p1.x, a.y - p1.y) - Math.hypot(b.x - p1.x, b.y - p1.y));

            let uniqueInters = [];
            inters.forEach((I) => {
              if (uniqueInters.length === 0 || Math.hypot(I.x - uniqueInters[uniqueInters.length - 1].x, I.y - uniqueInters[uniqueInters.length - 1].y) > 0.001)
                uniqueInters.push(I);
            });

            let microPts = [p1, ...uniqueInters, p2];
            for (let k = 0; k < microPts.length - 1; k++) {
              const m1 = microPts[k], m2 = microPts[k + 1];
              let cut = false;
              for (let j = 0; j < tPath.length - 1; j++)
                if (checkIntersect(m1, m2, tPath[j], tPath[j + 1], true)) {
                  cut = true;
                  break;
                }
              // ... 修剪後的點位處理邏輯 [cite: 254-258]
              if (cut) {
                if (cur.length > 0) {
                  cur.push({ ...m1, type: p2.type });
                  newPaths.push({ id: Math.random(), points: cur });
                  cur = [];
                }
              } else {
                if (cur.length === 0) cur.push({ ...m1, type: k === 0 ? p1.type : p2.type, c: p1.c, r: p1.r });
                if (k === microPts.length - 2) cur.push({ ...m2, type: p2.type, c: 0, r: 0 });
              }
            }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths.filter((p) => p.points && p.points.length > 1);
      });
    }
    interactionRef.current.isDragging = false;
    interactionRef.current.trimPath = [];
  };

  // ... (其餘 UI 與 return 部分保持不變)
  return (
    // ... JSX 內容 [cite: 262-371]
    <div>{/* 此處應包含原有的完整 UI */}</div>
  );
};

export default function App() {
  return <CncWorkspace />;
}
