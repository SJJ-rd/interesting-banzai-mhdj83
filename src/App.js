import React, { useEffect, useRef, useState, useMemo } from "react";

// ✅ 修正 1：核心幾何算法移至最外層，確保 handleMouseUp 能正確呼叫
const checkIntersect = (p1, p2, p3, p4, isTrimMode = false) => {
  if (!p1 || !p2 || !p3 || !p4 || typeof p1.x === "undefined" || typeof p3.x === "undefined") return null;
  const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(den) < 1e-10) return null; // 平行

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / den;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / den;

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
  
  // ✅ 修正 2：攝影機初始設為 0，由渲染邏輯自動校正
  const cameraRef = useRef({
    x: 0,
    y: 0,
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
  });

  const saveState = () =>
    setHistory((prev) => [
      ...prev.slice(-29),
      JSON.parse(JSON.stringify(paths)),
    ]);
  const handleUndo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const newH = [...prev];
      setPaths(newH.pop());
      return newH;
    });
    interactionRef.current.continuous = false;
    interactionRef.current.circleStart = null;
    interactionRef.current.arcPts = [];
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        interactionRef.current.continuous = false;
        interactionRef.current.circleStart = null;
        interactionRef.current.arcPts = [];
        setPaths((p) => [...p]);
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paths]);

  const getVisualPoints = (pts) => {
    if (!pts || !Array.isArray(pts)) return [];
    let res = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined")
        continue;

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

  const getOffsetPoints = (pts, toolR, isInner) => {
    if (!pts || !Array.isArray(pts) || pts.length < 2) return [];
    const dir = isInner ? -1 : 1;
    return pts.map((pt, i) => {
      if (!pt) return null;
      if (pt.type === "arc" && pt.radius) {
        const mag = pt.ccw ? (dir === 1 ? -toolR : toolR) : (dir === 1 ? toolR : -toolR);
        const newR = Math.max(0.001, pt.radius + mag);
        const newX = pt.cx + Math.cos(pt.endAngle) * newR;
        const newY = pt.cy + Math.sin(pt.endAngle) * newR;
        return { ...pt, radius: newR, x: newX, y: newY };
      }
      const p1 = i === 0 ? pt : pts[i - 1], p2 = i === 0 ? pts[1] : pt;
      if (!p1 || !p2) return { ...pt };
      const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
      if (len < 1e-5) return { ...pt };
      const newX = pt.x + (-dy / len) * toolR * dir;
      const newY = pt.y + (dx / len) * toolR * dir;
      return { ...pt, x: newX, y: newY };
    }).filter(Boolean);
  };

  const visualCompPaths = useMemo(() => visualPaths.map((p) => ({ ...p, points: getOffsetPoints(p.points, toolConfig.r, isInner) })), [visualPaths, toolConfig.r, isInner]);
  const activeCompPts = useMemo(() => visualCompPaths[paths.findIndex((p) => p.id === activePath?.id)]?.points || [], [activePath, visualCompPaths, paths]);

  const getTangentCircle = (mousePt) => {
    let best = null; let minD = 40 / cameraRef.current.zoom;
    paths.forEach((path) => {
      if (!path.points) return;
      for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = path.points[i], p2 = path.points[i + 1];
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const t = Math.max(0, Math.min(1, ((mousePt.x - p1.x) * dx + (mousePt.y - p1.y) * dy) / (len * len)));
        const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
        const dist = Math.hypot(mousePt.x - proj.x, mousePt.y - proj.y);
        if (dist < minD) { minD = dist; best = { cx: mousePt.x, cy: mousePt.y, r: dist }; }
      }
    });
    return best;
  };

  const calcSCE = (p1, center, p3) => {
    if (!p1 || !center || !p3) return null;
    const r = Math.hypot(p1.x - center.x, p1.y - center.y);
    const ccw = (center.x - p1.x) * (p3.y - p1.y) - (center.y - p1.y) * (p3.x - p1.x) > 0;
    return { cx: center.x, cy: center.y, radius: r, startAngle: Math.atan2(p1.y - center.y, p1.x - center.x), endAngle: Math.atan2(p3.y - center.y, p3.x - center.x), ccw };
  };

  const calcSER = (p1, p2, mouse) => {
    if (!p1 || !p2 || !mouse) return null;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const h = Math.hypot(mouse.x - mid.x, mouse.y - mid.y) || 1e-5;
    const r = h / 2 + (d * d) / (8 * h);
    const side = (p2.x - p1.x) * (mouse.y - p1.y) - (p2.y - p1.y) * (mouse.x - p1.x) > 0 ? 1 : -1;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cDist = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
    const cx = mid.x + cDist * Math.sin(angle) * side, cy = mid.y - cDist * Math.cos(angle) * side;
    return { cx, cy, radius: r, startAngle: Math.atan2(p1.y - cy, p1.x - cx), endAngle: Math.atan2(p2.y - cy, p2.x - cx), ccw: side > 0 };
  };

  const drawCross = (ctx, x, y, size, color, lw = 1) => {
    if (typeof x === "undefined" || typeof y === "undefined") return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw / cameraRef.current.zoom;
    ctx.beginPath(); ctx.moveTo(x - size / cameraRef.current.zoom, y); ctx.lineTo(x + size / cameraRef.current.zoom, y);
    ctx.moveTo(x, y - size / cameraRef.current.zoom); ctx.lineTo(x, y + size / cameraRef.current.zoom); ctx.stroke(); ctx.restore();
  };

  const solidifyFeatures = () => {
    if (!activePath) return;
    saveState();
    setPaths((prev) => prev.map((path) => path.id === activePath.id ? { ...path, points: getVisualPoints(path.points).map((p) => ({ ...p, c: 0, r: 0 })) } : path ));
  };

  const genGCode = () => {
    if (!activePath || !activePath.points || activePath.points.length < 2) { alert("請選定加工路徑！"); return; }
    const vPts = getVisualPoints(activePath.points);
    if (!vPts || vPts.length === 0) return;
    const startPt = vPts[0];
    const safeZ = Math.max(startPt.x, stock.face) + cam.safeDist;
    const safeX = isInner ? stock.id - cam.safeDist : stock.od + cam.safeDist;
    let g = `O2000 (CNC GEMINI MASTER)\nG50 S${cam.g50}\nT${toolConfig.code} M03 G96 S${cam.vc}\nG00 X${safeX.toFixed(3)} Z${safeZ.toFixed(3)} M08\n`;
    g += `G71 U${cam.doc} R0.5\nG71 P10 Q20 U${isInner ? -cam.allowX : cam.allowX} W${cam.allowZ} F${cam.feed}\nN10 G00 X${(-startPt.y * 2).toFixed(3)}\n`;
    vPts.forEach((pt, i) => {
      if (i === 0) return;
      const cmd = pt.type === "arc" ? (pt.ccw ? "G03" : "G02") : "G01";
      g += `${cmd} X${(-pt.y * 2).toFixed(3)} Z${pt.x.toFixed(3)}${pt.type === "arc" ? ` R${pt.radius.toFixed(3)}` : ""}\n`;
    });
    g += `N20 G01 X${isInner ? stock.id - 2 : stock.od + 2}\nM30`; setGcode(g);
  };

  const startSimulation = () => {
    if (!activeCompPts || activeCompPts.length < 2) { alert("請選擇加工路徑！"); return; }
    let sPts = []; const safeZ = Math.max(activeCompPts[0].x, stock.face) + cam.safeDist;
    const startDia = isInner ? stock.id : stock.od; const safeY = -(startDia + (isInner ? -cam.safeDist : cam.safeDist)) / 2;
    sPts.push({ x: safeZ, y: safeY, type: "G00" }); let currentY = -startDia / 2;
    const targetY = isInner ? Math.max(...activeCompPts.map((p) => p.y || 0)) : Math.min(...activeCompPts.map((p) => p.y || 0));
    let passes = 0;
    while ((isInner ? currentY < targetY : currentY > targetY) && passes < 150) {
      currentY += isInner ? cam.doc / 2 : -cam.doc / 2;
      if ((isInner && currentY > targetY) || (!isInner && currentY < targetY)) currentY = targetY;
      let endZ = activeCompPts[activeCompPts.length - 1].x;
      for (let i = 0; i < activeCompPts.length - 1; i++) {
        let p1 = activeCompPts[i], p2 = activeCompPts[i + 1];
        if (p1 && p2 && ((currentY >= p1.y && currentY <= p2.y) || (currentY <= p1.y && currentY >= p2.y))) {
          if (p1.y !== p2.y) endZ = p1.x + ((currentY - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x); break;
        }
      }
      sPts.push({ x: safeZ, y: currentY, type: "G00" }, { x: endZ, y: currentY, type: "G01" },
               { x: endZ + 0.5, y: currentY + (isInner ? -0.5 : 0.5), type: "G01" },
               { x: safeZ, y: currentY + (isInner ? -0.5 : 0.5), type: "G00" });
      passes++;
    }
    sPts.push({ x: safeZ, y: activeCompPts[0].y, type: "G00" });
    activeCompPts.forEach((pt) => sPts.push({ ...pt, type: pt.type || "G01" }));
    sPts.push({ x: safeZ, y: safeY, type: "G00" }); interactionRef.current.sim = { active: true, progress: 0, pts: sPts };
  };

  // ✅ 修正 3：精準自動置中與畫布渲染
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // 掛載時自動計算中心位置
    if (cameraRef.current.x === 0 && canvas.parentElement) {
      cameraRef.current.x = canvas.parentElement.clientWidth / 2 - 150;
      cameraRef.current.y = canvas.parentElement.clientHeight / 2;
    }

    const render = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cameraRef.current.x, cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      if (bgImage) { ctx.globalAlpha = bgOpacity; ctx.drawImage(bgImage, -200, -200, 400, 400); ctx.globalAlpha = 1; }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(-stock.length, -stock.od / 2, stock.length + Number(stock.face), stock.od);

      ctx.strokeStyle = "#333"; ctx.lineWidth = 1 / cameraRef.current.zoom; ctx.beginPath();
      for (let i = -500; i <= 500; i += 50) { ctx.moveTo(i, -500); ctx.lineTo(i, 500); ctx.moveTo(-500, i); ctx.lineTo(500, i); }
      ctx.stroke();
      ctx.strokeStyle = "#ff5722"; ctx.beginPath(); ctx.moveTo(0, -500); ctx.lineTo(0, 500); ctx.stroke();
      ctx.strokeStyle = "#007bff"; ctx.beginPath(); ctx.moveTo(-500, 0); ctx.lineTo(500, 0); ctx.stroke();
      drawCross(ctx, 0, 0, 20, "red", 2);

      visualPaths.forEach((p, idx) => {
        if (!p?.points) return;
        const isActive = p.id === activePath?.id;
        const isHovered = p.id === interactionRef.current.hoveredPathId && mode === "SELECT";
        ctx.lineWidth = isActive || isHovered ? 2.5/cameraRef.current.zoom : 1.5/cameraRef.current.zoom;
        ctx.strokeStyle = isActive ? "#00ff00" : (isHovered ? "#bfffbf" : "#4a824a");
        ctx.beginPath();
        p.points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else if (pt.type === "arc") ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, !pt.ccw);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        
        // 刀尖補正軌跡
        const cPts = visualCompPaths[idx]?.points;
        if (cPts && cPts.length > 0 && !interactionRef.current.sim.active) {
          ctx.beginPath(); ctx.strokeStyle = isActive ? toolConfig.color : "rgba(0, 255, 255, 0.3)";
          ctx.setLineDash([4 / cameraRef.current.zoom]);
          cPts.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else if (pt.type === "arc" && pt.radius) ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, !pt.ccw);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke(); ctx.setLineDash([]);
        }
      });

      if (mode === "TRIM" && interactionRef.current.trimPath.length > 0) {
        ctx.strokeStyle = "#ff4444"; ctx.lineWidth = 2 / cameraRef.current.zoom; ctx.beginPath();
        interactionRef.current.trimPath.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }

      // 模擬動畫渲染邏輯
      if (interactionRef.current.sim.active) {
        let sim = interactionRef.current.sim; sim.progress += 0.15;
        if (sim.progress >= sim.pts.length - 1) { sim.progress = sim.pts.length - 1; sim.active = false; }
        const idx = Math.floor(sim.progress), nextIdx = Math.min(idx + 1, sim.pts.length - 1), t = sim.progress - idx;
        const pt1 = sim.pts[idx], pt2 = sim.pts[nextIdx];
        if (pt1 && pt2) {
          const curX = pt1.x + (pt2.x - pt1.x) * t, curY = pt1.y + (pt2.y - pt1.y) * t;
          ctx.lineWidth = 2 / cameraRef.current.zoom;
          for (let i = 1; i <= idx; i++) {
            ctx.strokeStyle = sim.pts[i].type === "G00" ? "#ff4444" : toolConfig.color;
            ctx.setLineDash(sim.pts[i].type === "G00" ? [3/cameraRef.current.zoom] : []);
            ctx.beginPath(); ctx.moveTo(sim.pts[i-1].x, sim.pts[i-1].y); ctx.lineTo(sim.pts[i].x, sim.pts[i].y); ctx.stroke();
          }
          ctx.fillStyle = toolConfig.color; ctx.beginPath(); ctx.arc(curX, curY, toolConfig.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      requestAnimationFrame(render);
    };
    render();
  }, [visualPaths, activePath, stock, mode, circleSubMode, isOrtho, lineMode, arcSubMode, toolConfig, isInner]);

  const handleMouseDown = (e) => {
    if (e.button === 2) { interactionRef.current.continuous = false; setPaths((p) => [...p]); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = { x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom, y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom };
    
    if (mode === "PAN") { interactionRef.current.isDragging = true; interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY }; }
    else if (mode === "TRIM") { interactionRef.current.isDragging = true; interactionRef.current.trimPath = [rawPt]; }
    else if (mode === "DRAW_LINE") {
      saveState();
      setPaths((prev) => {
        let n = [...prev]; const idx = n.findIndex(p => p.id === activePath?.id);
        if (!interactionRef.current.continuous || idx === -1) {
          const id = Date.now(); n.push({ id, points: [{ ...rawPt, type: lineMode, c: 0, r: 0 }] }); setSelectedPathId(id);
        } else { n[idx].points.push({ ...rawPt, type: lineMode, c: 0, r: 0 }); }
        return n;
      });
      interactionRef.current.continuous = true;
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = { x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom, y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom };
    interactionRef.current.currentPt = rawPt;
    if (interactionRef.current.isDragging) {
      if (mode === "PAN") { cameraRef.current.x += e.clientX - interactionRef.current.lastMouse.x; cameraRef.current.y += e.clientY - interactionRef.current.lastMouse.y; interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY }; }
      else if (mode === "TRIM") interactionRef.current.trimPath.push(rawPt);
    }
  };

  const handleMouseUp = () => {
    if (mode === "TRIM" && interactionRef.current.trimPath.length > 1) {
      saveState(); const tPath = interactionRef.current.trimPath;
      setPaths((prev) => {
        const allSegs = []; prev.forEach(p => { if (p.points) for (let i = 0; i < p.points.length-1; i++) allSegs.push({ A: p.points[i], B: p.points[i+1] }); });
        let newPaths = [];
        prev.forEach(path => {
          if (!path.points) return; let cur = [];
          for (let i = 0; i < path.points.length-1; i++) {
            const p1 = path.points[i], p2 = path.points[i+1];
            let cut = false;
            for (let j = 0; j < tPath.length - 1; j++) {
              // ✅ 此處現在可以正確呼叫檔案頂部的 checkIntersect
              if (checkIntersect(p1, p2, tPath[j], tPath[j+1], true)) { cut = true; break; }
            }
            if (cut) { if (cur.length > 0) { newPaths.push({ id: Math.random(), points: [...cur, p1] }); cur = []; } }
            else { cur.push(p1); if (i === path.points.length-2) cur.push(p2); }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths;
      });
    }
    interactionRef.current.isDragging = false; interactionRef.current.trimPath = [];
  };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", backgroundColor: "#1e1e1e", color: "white", overflow: "hidden" }}>
      <div style={{ flexGrow: 1, position: "relative" }}>
        <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onWheel={(e) => { cameraRef.current.zoom = Math.max(0.1, Math.min(cameraRef.current.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 100)); }} onContextMenu={(e) => e.preventDefault()} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: "5px", background: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "8px", flexWrap: "wrap", maxWidth: "85%" }}>
          <button onClick={handleUndo} style={{ background: "#ff9800", border: "none", padding: "6px 12px", borderRadius: "4px", fontWeight: "bold" }}>↩ 復原</button>
          <button onClick={() => setMode("DRAW_LINE")} style={{ background: mode === "DRAW_LINE" ? "#28a745" : "#444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px" }}>✏️ 直線</button>
          <button onClick={() => setMode("TRIM")} style={{ background: mode === "TRIM" ? "#ff4444" : "#444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px" }}>✂️ 修剪</button>
          <button onClick={() => setMode("PAN")} style={{ background: mode === "PAN" ? "#007bff" : "#444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px" }}>✋ 平移</button>
          <button onClick={() => setPaths([])} style={{ background: "#6c757d", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px" }}>✖ 清除</button>
        </div>
        <div style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(0,0,0,0.6)", padding: "8px", borderRadius: "4px", color: "#00ff00", fontFamily: "monospace" }}>Z: <span id="coordZ">0.000</span> / X(直): <span id="coordX">0.000</span></div>
      </div>
      <div style={{ width: "400px", background: "#252526", padding: "20px", borderLeft: "1px solid #444", overflowY: "auto" }}>
        <h3 style={{ color: "#00FFFF", marginTop: 0 }}>📦 CNC 專業參數面板</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "15px" }}>
           <div><label style={{fontSize:"12px"}}>外徑 OD</label><input type="number" value={stock.od} onChange={e=>setStock({...stock, od: e.target.value})} style={{width:"100%", background:"#111", color:"#fff", border:"none", padding:"5px"}}/></div>
           <div><label style={{fontSize:"12px"}}>長度 L</label><input type="number" value={stock.length} onChange={e=>setStock({...stock, length: e.target.value})} style={{width:"100%", background:"#111", color:"#fff", border:"none", padding:"5px"}}/></div>
        </div>
        <button onClick={startSimulation} style={{ width: "100%", padding: "10px", background: "#17a2b8", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold", marginBottom: "5px" }}>🎬 啟動模擬</button>
        <button onClick={genGCode} style={{ width: "100%", padding: "15px", background: "#28a745", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold", fontSize: "16px" }}>🚀 產生 G-Code</button>
        <textarea value={gcode} readOnly style={{ width: "100%", height: "250px", marginTop: "15px", background: "#000", color: "#00ff00", fontFamily: "monospace", fontSize: "12px", border: "1px solid #444" }} />
      </div>
    </div>
  );
};

export default function App() { return <CncWorkspace />; }
