import React, { useEffect, useRef, useState, useMemo } from "react";

/**
 * CNC Gemini Master - 專業車床 CAD/CAM 整合介面
 * 修正版：解決修剪報錯、優化圓弧粗車模擬、標準化 G-Code 生成
 */

const CncWorkspace = () => {
  // --- 狀態管理 ---
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
  const [toolConfig, setToolConfig] = useState({
    code: "0101",
    r: 0.8,
    angle: 55,
    color: "#00FFFF",
  });
  const [stock, setStock] = useState({ od: 80, id: 0, length: 120, face: 2.0 });
  const [cam, setCam] = useState({
    vc: 200,
    g50: 2500,
    feed: 0.2,
    doc: 2.0,
    safeDist: 2.0,
    allowX: 0.5,
    allowZ: 0.1,
  });
  const [gcode, setGcode] = useState("");

  const canvasRef = useRef(null);
  const cameraRef = useRef({
    x: window.innerWidth / 2 - 150,
    y: window.innerHeight / 2,
    zoom: 1.5,
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
    hoveredPathId: null,
    hoveredCorner: null,
  });

  // --- 核心幾何運算引擎 ---

  // 1. 修正：新增交點檢查函數，解決 Trim 功能報錯
  const checkIntersect = (A, B, C, D, isBoolean = false) => {
    if (!A || !B || !C || !D) return null;
    const den = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);
    if (Math.abs(den) < 1e-8) return null; 
    const t = ((D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x)) / den;
    const u = ((B.x - A.x) * (A.y - C.y) - (B.y - A.y) * (A.x - C.x)) / den;
    
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      if (isBoolean) return true;
      return { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
    }
    return null;
  };

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

  const getOffsetPoints = (pts, toolR, isInner) => {
    if (!pts || pts.length < 2) return [];
    const dir = isInner ? -1 : 1;
    return pts.map((pt, i) => {
      if (pt.type === "arc" && pt.radius) {
        const mag = pt.ccw ? (dir === 1 ? -toolR : toolR) : (dir === 1 ? toolR : -toolR);
        const newR = Math.max(0.001, pt.radius + mag);
        const newX = pt.cx + Math.cos(pt.endAngle) * newR;
        const newY = pt.cy + Math.sin(pt.endAngle) * newR;
        return { ...pt, radius: newR, x: newX, y: newY };
      }
      const p1 = i === 0 ? pt : pts[i - 1], p2 = i === 0 ? pts[1] : pt;
      const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
      if (len < 1e-5) return { ...pt };
      return { ...pt, x: pt.x + (-dy / len) * toolR * dir, y: pt.y + (dx / len) * toolR * dir };
    });
  };

  const visualCompPaths = useMemo(() => visualPaths.map(p => ({
    ...p, points: getOffsetPoints(p.points, toolConfig.r, isInner)
  })), [visualPaths, toolConfig.r, isInner]);

  const activeCompPts = useMemo(() => visualCompPaths.find(p => p.id === activePath?.id)?.points || [], [activePath, visualCompPaths]);

  // --- 功能邏輯 ---

  const saveState = () => setHistory(prev => [...prev.slice(-29), JSON.parse(JSON.stringify(paths))]);
  
  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const newH = [...prev];
      setPaths(newH.pop());
      return newH;
    });
    interactionRef.current.continuous = false;
  };

  const genGCode = () => {
    if (!activePath || activePath.points.length < 2) {
      alert("請選擇加工路徑！");
      return;
    }
    const vPts = getVisualPoints(activePath.points);
    const startPt = vPts[0];
    const safeZ = stock.face + cam.safeDist;
    const safeX = isInner ? stock.id - cam.safeDist : stock.od + cam.safeDist;

    let g = `O2000 (CNC GEMINI MASTER)\nG50 S${cam.g50}\nT${toolConfig.code} M03 G96 S${cam.vc}\nG00 X${safeX.toFixed(3)} Z${safeZ.toFixed(3)} M08\n`;
    g += `G71 U${cam.doc} R0.5\nG71 P10 Q20 U${(isInner ? -cam.allowX : cam.allowX).toFixed(3)} W${cam.allowZ} F${cam.feed}\nN10 G00 X${(-startPt.y * 2).toFixed(3)}\n`;
    
    vPts.forEach((pt, i) => {
      if (i === 0) return;
      const cmd = pt.type === "arc" ? (pt.ccw ? "G03" : "G02") : "G01";
      g += `${cmd} X${(-pt.y * 2).toFixed(3)} Z${pt.x.toFixed(3)}${pt.type === "arc" ? ` R${pt.radius.toFixed(3)}` : ""}\n`;
    });
    
    g += `N20 G01 X${(isInner ? stock.id - 2 : stock.od + 2).toFixed(3)}\nG70 P10 Q20\nM30`;
    setGcode(g);
  };

  // 2. 修正：優化粗車模擬，正確處理圓弧交點
  const startSimulation = () => {
    if (!activeCompPts.length) return alert("請選擇加工路徑！");
    let sPts = [];
    const safeZ = stock.face + cam.safeDist;
    const startDia = isInner ? stock.id : stock.od;
    const safeY = -(startDia + (isInner ? -cam.safeDist : cam.safeDist)) / 2;

    sPts.push({ x: safeZ, y: safeY, type: "G00" });
    let currentY = -startDia / 2;
    const targetY = isInner ? Math.max(...activeCompPts.map(p => p.y)) : Math.min(...activeCompPts.map(p => p.y));
    let passes = 0;

    while ((isInner ? currentY < targetY : currentY > targetY) && passes < 150) {
      currentY += isInner ? cam.doc / 2 : -cam.doc / 2;
      if ((isInner && currentY > targetY) || (!isInner && currentY < targetY)) currentY = targetY;

      let endZ = activeCompPts[activeCompPts.length - 1].x;
      for (let i = 0; i < activeCompPts.length - 1; i++) {
        let p1 = activeCompPts[i], p2 = activeCompPts[i + 1];
        if ((currentY >= p1.y && currentY <= p2.y) || (currentY <= p1.y && currentY >= p2.y)) {
          if (p2.type === "arc" && p2.radius) {
            const dy = Math.abs(currentY - p2.cy);
            if (dy <= p2.radius) endZ = p2.cx + Math.sqrt(p2.radius ** 2 - dy ** 2);
          } else if (Math.abs(p2.y - p1.y) > 1e-5) {
            endZ = p1.x + ((currentY - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x);
          }
          break;
        }
      }
      sPts.push({ x: safeZ, y: currentY, type: "G00" }, { x: endZ, y: currentY, type: "G01" });
      sPts.push({ x: endZ + 0.5, y: currentY + (isInner ? -0.5 : 0.5), type: "G01" });
      sPts.push({ x: safeZ, y: currentY + (isInner ? -0.5 : 0.5), type: "G00" });
      passes++;
    }
    activeCompPts.forEach(pt => sPts.push({ ...pt, type: pt.type || "G01" }));
    interactionRef.current.sim = { active: true, progress: 0, pts: sPts };
  };

  // --- 畫布繪製 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const render = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cameraRef.current.x, cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      // 繪製素材
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(-stock.length, -stock.od / 2, stock.length + Number(stock.face), (stock.od - stock.id) / 2);

      // 繪製座標軸與網格
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 0.5 / cameraRef.current.zoom;
      ctx.beginPath();
      for (let i = -500; i <= 500; i += 50) {
        ctx.moveTo(i, -500); ctx.lineTo(i, 500);
        ctx.moveTo(-500, i); ctx.lineTo(500, i);
      }
      ctx.stroke();

      // 繪製路徑
      visualPaths.forEach((p, idx) => {
        const isActive = p.id === activePath?.id;
        ctx.lineWidth = isActive ? 2 / cameraRef.current.zoom : 1 / cameraRef.current.zoom;
        ctx.strokeStyle = isActive ? "#00ff00" : "#4a824a";
        ctx.beginPath();
        p.points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else if (pt.type === "arc") ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, !pt.ccw);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      });

      // 模擬動畫
      if (interactionRef.current.sim.active) {
        let sim = interactionRef.current.sim;
        sim.progress += 0.2;
        if (sim.progress >= sim.pts.length - 1) sim.active = false;
        const curIdx = Math.floor(sim.progress);
        const pt = sim.pts[curIdx];
        if (pt) {
          ctx.fillStyle = toolConfig.color;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, toolConfig.r, 0, Math.PI * 2); ctx.fill();
        }
      }

      ctx.restore();
      requestAnimationFrame(render);
    };
    render();
  }, [visualPaths, stock, activePath, toolConfig]);

  // --- 事件處理 ---
  const handleMouseDown = (e) => {
    if (e.button === 2) { interactionRef.current.continuous = false; return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    if (mode === "DRAW_LINE") {
      saveState();
      setPaths(prev => {
        let n = [...prev];
        if (!interactionRef.current.continuous) {
          const id = Date.now();
          n.push({ id, points: [{ ...rawPt, type: lineMode, c: 0, r: 0 }] });
          setSelectedPathId(id);
        } else {
          const idx = n.findIndex(p => p.id === activePath?.id);
          if (idx !== -1) n[idx].points.push({ ...rawPt, type: lineMode, c: 0, r: 0 });
        }
        return n;
      });
      interactionRef.current.continuous = true;
    } else if (mode === "TRIM") {
      interactionRef.current.isDragging = true;
      interactionRef.current.trimPath = [rawPt];
    } else if (mode === "PAN") {
        interactionRef.current.isDragging = true;
        interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY };
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
      setPaths(prev => {
        let newPaths = [];
        prev.forEach(path => {
          if (!path.points) return;
          let cur = [];
          for (let i = 0; i < path.points.length - 1; i++) {
            const p1 = path.points[i], p2 = path.points[i + 1];
            let cut = false;
            for (let j = 0; j < tPath.length - 1; j++) {
              if (checkIntersect(p1, p2, tPath[j], tPath[j + 1], true)) { cut = true; break; }
            }
            if (cut) {
              if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
              cur = [];
            } else {
              if (cur.length === 0) cur.push(p1);
              cur.push(p2);
            }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths;
      });
    }
    interactionRef.current.isDragging = false;
  };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", backgroundColor: "#1e1e1e", color: "white" }}>
      <div style={{ flexGrow: 1, position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} 
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} 
          onWheel={(e) => cameraRef.current.zoom *= (e.deltaY > 0 ? 0.9 : 1.1)}
        />
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: "10px", background: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "8px" }}>
          <button onClick={() => setMode("DRAW_LINE")}>✏️ 繪圖</button>
          <button onClick={() => setMode("TRIM")}>✂️ 修剪</button>
          <button onClick={() => setMode("PAN")}>✋ 平移</button>
          <button onClick={handleUndo}>↩ 復原</button>
          <button onClick={() => setPaths([])}>✖ 清除</button>
        </div>
      </div>

      <div style={{ width: "350px", background: "#252526", padding: "20px", borderLeft: "1px solid #444", overflowY: "auto" }}>
        <h3 style={{ color: "#00FFFF" }}>📦 加工參數</h3>
        <div style={{ display: "grid", gap: "10px" }}>
          <label>素材外徑: <input type="number" value={stock.od} onChange={e => setStock({...stock, od: e.target.value})} /></label>
          <label>粗車切深: <input type="number" value={cam.doc} onChange={e => setCam({...cam, doc: parseFloat(e.target.value)})} /></label>
          <button onClick={startSimulation} style={{ padding: "10px", background: "#007bff", color: "white" }}>🎥 模擬加工</button>
          <button onClick={genGCode} style={{ padding: "10px", background: "#28a745", color: "white" }}>🚀 產生 G-Code</button>
        </div>
        <textarea value={gcode} readOnly style={{ width: "100%", height: "200px", marginTop: "20px", background: "#000", color: "#00ff00", fontFamily: "monospace" }} />
      </div>
    </div>
  );
};

export default function App() { return <CncWorkspace />; }
