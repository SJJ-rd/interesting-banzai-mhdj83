import React, { useEffect, useRef, useState, useMemo } from "react";

// ✅ 1. 核心幾何算法：放在最外層確保所有函數都能存取
const checkIntersect = (p1, p2, p3, p4, isTrimMode = false) => {
  if (!p1 || !p2 || !p3 || !p4 || typeof p1.x === 'undefined' || typeof p3.x === 'undefined') return null;
  const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(den) < 1e-10) return null; // 平行
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / den;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / den;
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
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
  
  // ✅ 2. 自動置中邏輯：初始化攝影機位置
  const cameraRef = useRef({
    x: window.innerWidth / 2 - 100, // 稍微偏左給右側選單留空間
    y: window.innerHeight / 2,
    zoom: 1.2,
  });

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

  // --- 基礎操作 ---
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

  // --- 幾何計算 ---
  const getVisualPoints = (pts) => {
    if (!pts || !Array.isArray(pts)) return [];
    let res = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if ((pt.c > 0 || pt.r > 0) && i > 0 && i < pts.length - 1) {
        const p = pts[i - 1], n = pts[i + 1];
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

  const visualPaths = useMemo(() => paths.map(p => ({ ...p, points: getVisualPoints(p.points) })), [paths]);
  const activePath = useMemo(() => paths.find(p => p.id === selectedPathId) || paths[paths.length - 1], [paths, selectedPathId]);

  // --- 事件處理 (MouseDown/Move/Up) ---
  const handleMouseDown = (e) => {
    if (e.button === 2) { interactionRef.current.continuous = false; return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    let snapPt = rawPt;
    if (Math.hypot(rawPt.x, rawPt.y) < 10) snapPt = { x: 0, y: 0 };

    if (mode === "PAN") {
      interactionRef.current.isDragging = true;
      interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY };
    } else if (mode === "TRIM") {
      interactionRef.current.isDragging = true;
      interactionRef.current.trimPath = [rawPt];
    } else if (mode === "DRAW_LINE") {
      saveState();
      setPaths(prev => {
        let n = [...prev];
        if (!interactionRef.current.continuous || n.length === 0) {
          const id = Date.now();
          n.push({ id, points: [{ ...snapPt, type: lineMode }] });
          setSelectedPathId(id);
        } else {
          const idx = n.findIndex(p => p.id === activePath?.id);
          if (idx !== -1) n[idx].points.push({ ...snapPt, type: lineMode });
        }
        return n;
      });
      interactionRef.current.continuous = true;
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };
    interactionRef.current.currentPt = rawPt;

    if (interactionRef.current.isDragging) {
      if (mode === "PAN") {
        cameraRef.current.x += e.clientX - interactionRef.current.lastMouse.x;
        cameraRef.current.y += e.clientY - interactionRef.current.lastMouse.y;
        interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY };
      } else if (mode === "TRIM") {
        interactionRef.current.trimPath.push(rawPt);
      }
    }
  };

  const handleMouseUp = () => {
    if (mode === "TRIM" && interactionRef.current.trimPath.length > 1) {
      saveState();
      const tPath = interactionRef.current.trimPath;
      setPaths((prev) => {
        const allSegs = [];
        prev.forEach(path => {
          if (path.points) {
            for (let i = 0; i < path.points.length - 1; i++) {
              if (path.points[i] && path.points[i+1])
                allSegs.push({ A: path.points[i], B: path.points[i+1] });
            }
          }
        });

        let newPaths = [];
        prev.forEach(path => {
          let cur = [];
          for (let i = 0; i < path.points.length - 1; i++) {
            const p1 = path.points[i], p2 = path.points[i+1];
            let cut = false;
            for (let j = 0; j < tPath.length - 1; j++) {
              if (checkIntersect(p1, p2, tPath[j], tPath[j+1], true)) { cut = true; break; }
            }
            if (cut) {
              if (cur.length > 0) { newPaths.push({ id: Math.random(), points: [...cur, p1] }); cur = []; }
            } else {
              cur.push(p1);
              if (i === path.points.length - 2) cur.push(p2);
            }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths;
      });
    }
    interactionRef.current.isDragging = false;
    interactionRef.current.trimPath = [];
  };

  // --- 畫布渲染 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const render = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cameraRef.current.x, cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      // 繪製背景工件
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(-stock.length, -stock.od/2, stock.length + Number(stock.face), stock.od);

      // 軸線
      ctx.strokeStyle = "#444"; ctx.beginPath();
      ctx.moveTo(-500, 0); ctx.lineTo(500, 0); ctx.moveTo(0, -300); ctx.lineTo(0, 300); ctx.stroke();
      
      // 繪製路徑
      visualPaths.forEach(p => {
        ctx.strokeStyle = p.id === selectedPathId ? "#00ff00" : "#4a824a";
        ctx.lineWidth = 2 / cameraRef.current.zoom;
        ctx.beginPath();
        p.points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else if (pt.type === "arc") ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, !pt.ccw);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      });

      // 繪製修剪紅線
      if (mode === "TRIM" && interactionRef.current.trimPath.length > 0) {
        ctx.strokeStyle = "red"; ctx.beginPath();
        interactionRef.current.trimPath.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }

      ctx.restore();
      requestAnimationFrame(render);
    };
    render();
  }, [visualPaths, selectedPathId, stock, mode]);

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", backgroundColor: "#1e1e1e", color: "white" }}>
      <div style={{ flexGrow: 1, position: "relative" }}>
        <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onContextMenu={e => e.preventDefault()} style={{ width: "100%", height: "100%", cursor: "crosshair" }} />
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: "5px", background: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "8px" }}>
          <button onClick={() => setMode("DRAW_LINE")} style={{ background: mode === "DRAW_LINE" ? "#28a745" : "#444", color: "white", border: "none", padding: "8px 15px", borderRadius: "4px", cursor: "pointer" }}>✏️ 直線</button>
          <button onClick={() => setMode("TRIM")} style={{ background: mode === "TRIM" ? "#dc3545" : "#444", color: "white", border: "none", padding: "8px 15px", borderRadius: "4px", cursor: "pointer" }}>✂️ 修剪</button>
          <button onClick={() => setMode("PAN")} style={{ background: mode === "PAN" ? "#007bff" : "#444", color: "white", border: "none", padding: "8px 15px", borderRadius: "4px", cursor: "pointer" }}>✋ 平移</button>
          <button onClick={handleUndo} style={{ background: "#ff9800", color: "white", border: "none", padding: "8px 15px", borderRadius: "4px", cursor: "pointer" }}>↩ 復原</button>
        </div>
      </div>
      <div style={{ width: "350px", background: "#252526", padding: "20px", borderLeft: "1px solid #444" }}>
        <h3 style={{ color: "#00FFFF" }}>⚙️ CNC 參數設定</h3>
        <div style={{ marginBottom: "15px" }}>
          <label>工件外徑 OD: </label>
          <input type="number" value={stock.od} onChange={e => setStock({...stock, od: e.target.value})} style={{ width: "60px", background: "#111", color: "#fff", border: "none", padding: "5px" }} />
        </div>
        <button onClick={() => alert("G-Code 產生功能開發中")} style={{ width: "100%", padding: "15px", background: "#28a745", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }}>🚀 產生 G-Code</button>
      </div>
    </div>
  );
};

export default function App() { return <CncWorkspace />; }
