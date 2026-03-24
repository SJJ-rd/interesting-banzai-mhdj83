import React, { useEffect, useRef, useState, useMemo } from "react";

// ✅ 搬移到這裡：檔案最頂端，全域可用
const checkIntersect = (p1, p2, p3, p4, isTrimMode = false) => {
  const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(den) < 1e-10) return null;
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

  // --- 幾何計算引擎 ---
  const getVisualPoints = (pts) => {
    if (!pts || !Array.isArray(pts)) return [];
    let res = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined")
        continue;

      if ((pt.c > 0 || pt.r > 0) && i > 0 && i < pts.length - 1) {
        const p = pts[i - 1],
          n = pts[i + 1];
        if (!p || !n) {
          res.push(pt);
          continue;
        }

        const v1 = { x: p.x - pt.x, y: p.y - pt.y },
          v2 = { x: n.x - pt.x, y: n.y - pt.y };
        const l1 = Math.hypot(v1.x, v1.y),
          l2 = Math.hypot(v2.x, v2.y);
        if (l1 < 0.001 || l2 < 0.001) {
          res.push(pt);
          continue;
        }
        v1.x /= l1;
        v1.y /= l1;
        v2.x /= l2;
        v2.y /= l2;

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
          let nx = -v1.y,
            ny = v1.x;
          if (nx * v2.x + ny * v2.y < 0) {
            nx *= -1;
            ny *= -1;
          }
          
          // 🔥 修正：已移除內部重複宣告的 checkIntersect
          
          const cx = pA.x + nx * r,
            cy = pA.y + ny * r;
          const pB_x = pt.x + v2.x * d,
            pB_y = pt.y + v2.y * d;
          res.push(pA, {
            x: pB_x,
            y: pB_y,
            type: "arc",
            radius: r,
            ccw,
            cx,
            cy,
            startAngle: Math.atan2(pA.y - cy, pA.x - cx),
            endAngle: Math.atan2(pB_y - cy, pB_x - cx),
          });
        }
      } else res.push({ ...pt });
    }
    return res;
  };

  const visualPaths = useMemo(
    () => paths.map((p) => ({ ...p, points: getVisualPoints(p.points) })),
    [paths]
  );
  
  const activePath = useMemo(
    () => paths.find((p) => p.id === selectedPathId) || paths[paths.length - 1],
    [paths, selectedPathId]
  );

  const getOffsetPoints = (pts, toolR, isInner) => {
    if (!pts || !Array.isArray(pts) || pts.length < 2) return [];
    const dir = isInner ? -1 : 1;
    return pts
      .map((pt, i) => {
        if (!pt) return null;
        if (pt.type === "arc" && pt.radius) {
          const mag = pt.ccw
            ? dir === 1
              ? -toolR
              : toolR
            : dir === 1
            ? toolR
            : -toolR;
          const newR = Math.max(0.001, pt.radius + mag);
          const newX = pt.cx + Math.cos(pt.endAngle) * newR;
          const newY = pt.cy + Math.sin(pt.endAngle) * newR;
          return { ...pt, radius: newR, x: newX, y: newY };
        }
        const p1 = i === 0 ? pt : pts[i - 1],
          p2 = i === 0 ? pts[1] : pt;
        if (!p1 || !p2) return { ...pt };
        const dx = p2.x - p1.x,
          dy = p2.y - p1.y,
          len = Math.hypot(dx, dy);
        if (len < 1e-5) return { ...pt };
        const newX = pt.x + (-dy / len) * toolR * dir;
        const newY = pt.y + (dx / len) * toolR * dir;
        return { ...pt, x: newX, y: newY };
      })
      .filter(Boolean);
  };

  const visualCompPaths = useMemo(
    () =>
      visualPaths.map((p) => ({
        ...p,
        points: getOffsetPoints(p.points, toolConfig.r, isInner),
      })),
    [visualPaths, toolConfig.r, isInner]
  );
  
  const activeCompPts = useMemo(
    () =>
      visualCompPaths[paths.findIndex((p) => p.id === activePath?.id)]
        ?.points || [],
    [activePath, visualCompPaths, paths]
  );

  const lineIntersect = (A, B, C, D) => {
    if (!A || !B || !C || !D) return null;
    const den = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);
    if (Math.abs(den) < 1e-8) return null;
    const t = ((D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x)) / den;
    const u = ((B.x - A.x) * (A.y - C.y) - (B.y - A.y) * (A.x - C.x)) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1
      ? { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) }
      : null;
  };

  const getTangentCircle = (mousePt) => {
    let best = null;
    let minD = 40 / cameraRef.current.zoom;
    paths.forEach((path) => {
      if (!path.points || !Array.isArray(path.points)) return;
      for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = path.points[i],
          p2 = path.points[i + 1];
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x,
          dy = p2.y - p1.y,
          len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((mousePt.x - p1.x) * dx + (mousePt.y - p1.y) * dy) / (len * len)
          )
        );
        const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
        const dist = Math.hypot(mousePt.x - proj.x, mousePt.y - proj.y);
        if (dist < minD) {
          minD = dist;
          best = { cx: mousePt.x, cy: mousePt.y, r: dist };
        }
      }
    });
    return best;
  };

  const calcSCE = (p1, center, p3) => {
    if (!p1 || !center || !p3) return null;
    const r = Math.hypot(p1.x - center.x, p1.y - center.y);
    const ccw =
      (center.x - p1.x) * (p3.y - p1.y) - (center.y - p1.y) * (p3.x - p1.x) > 0;
    return {
      cx: center.x,
      cy: center.y,
      radius: r,
      startAngle: Math.atan2(p1.y - center.y, p1.x - center.x),
      endAngle: Math.atan2(p3.y - center.y, p3.x - center.x),
      ccw,
    };
  };

  const calcSER = (p1, p2, mouse) => {
    if (!p1 || !p2 || !mouse) return null;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const h = Math.hypot(mouse.x - mid.x, mouse.y - mid.y) || 1e-5;
    const r = h / 2 + (d * d) / (8 * h);
    const side =
      (p2.x - p1.x) * (mouse.y - p1.y) - (p2.y - p1.y) * (mouse.x - p1.x) > 0
        ? 1
        : -1;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cDist = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
    const cx = mid.x + cDist * Math.sin(angle) * side,
      cy = mid.y - cDist * Math.cos(angle) * side;
    return {
      cx,
      cy,
      radius: r,
      startAngle: Math.atan2(p1.y - cy, p1.x - cx),
      endAngle: Math.atan2(p2.y - cy, p2.x - cx),
      ccw: side > 0,
    };
  };

  const drawCross = (ctx, x, y, size, color, lw = 1) => {
    if (typeof x === "undefined" || typeof y === "undefined") return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw / cameraRef.current.zoom;
    ctx.beginPath();
    ctx.moveTo(x - size / cameraRef.current.zoom, y);
    ctx.lineTo(x + size / cameraRef.current.zoom, y);
    ctx.moveTo(x, y - size / cameraRef.current.zoom);
    ctx.lineTo(x, y + size / cameraRef.current.zoom);
    ctx.stroke();
    ctx.restore();
  };

  const solidifyFeatures = () => {
    if (!activePath) return;
    saveState();
    setPaths((prev) =>
      prev.map((path) =>
        path.id === activePath.id
          ? {
              ...path,
              points: getVisualPoints(path.points).map((p) => ({
                ...p,
                c: 0,
                r: 0,
              })),
            }
          : path
      )
    );
  };

  const applyOffset = () => {
    if (!activePath || !activePath.points) return;
    saveState();
    const newPts = activePath.points.map((p) => ({
      ...p,
      y: p.y - (offsetDist / 2) * (isInner ? -1 : 1),
      c: 0,
      r: 0,
    }));
    const newId = Date.now();
    setPaths((prev) => [
      ...prev,
      { id: newId, points: newPts, isOffset: true },
    ]);
    setSelectedPathId(newId);
  };

  const genGCode = () => {
    if (!activePath || !activePath.points || activePath.points.length < 2) {
      alert("請畫出或選定一條包含2點以上的加工路徑！");
      return;
    }
    const vPts = getVisualPoints(activePath.points);
    if (!vPts || vPts.length === 0) return;
    const startPt = vPts[0];
    const safeZ = Math.max(startPt.x, stock.face) + cam.safeDist;
    const safeX = isInner ? stock.id - cam.safeDist : stock.od + cam.safeDist;

    let g = `O2000 (CNC GEMINI MASTER)\nG50 S${cam.g50}\nT${
      toolConfig.code
    } M03 G96 S${cam.vc}\nG00 X${safeX.toFixed(3)} Z${safeZ.toFixed(3)} M08\n`;
    g += `G71 U${cam.doc} R0.5\nG71 P10 Q20 U${
      isInner ? -cam.allowX : cam.allowX
    } W${cam.allowZ} F${cam.feed}\nN10 G00 X${(-startPt.y * 2).toFixed(3)}\n`;
    vPts.forEach((pt, i) => {
      if (i === 0) return;
      const cmd =
        pt.type === "arc" ? (pt.ccw ? "G03" : "G02") : pt.type || "G01";
      g += `${cmd} X${(-pt.y * 2).toFixed(3)} Z${pt.x.toFixed(3)}${
        pt.type === "arc" ? ` R${pt.radius.toFixed(3)}` : ""
      }\n`;
    });
    g += `N20 G01 X${isInner ? stock.id - 2 : stock.od + 2}\nM30`;
    setGcode(g);
  };

  const startSimulation = () => {
    if (!activeCompPts || activeCompPts.length < 2) {
      alert("請選擇加工路徑！");
      return;
    }
    let sPts = [];
    const safeZ = Math.max(activeCompPts[0].x, stock.face) + cam.safeDist;
    const startDia = isInner ? stock.id : stock.od;
    const safeY = -(startDia + (isInner ? -cam.safeDist : cam.safeDist)) / 2;

    sPts.push({ x: safeZ, y: safeY, type: "G00" });
    let currentY = -startDia / 2;
    const targetY = isInner
      ? Math.max(...activeCompPts.map((p) => p.y || 0))
      : Math.min(...activeCompPts.map((p) => p.y || 0));
    let passes = 0;

    while (
      (isInner ? currentY < targetY : currentY > targetY) &&
      passes < 150
    ) {
      currentY += isInner ? cam.doc / 2 : -cam.doc / 2;
      if ((isInner && currentY > targetY) || (!isInner && currentY < targetY))
        currentY = targetY;

      let endZ = activeCompPts[activeCompPts.length - 1].x;
      for (let i = 0; i < activeCompPts.length - 1; i++) {
        let p1 = activeCompPts[i],
          p2 = activeCompPts[i + 1];
        if (!p1 || !p2) continue;
        if (
          (currentY >= p1.y && currentY <= p2.y) ||
          (currentY <= p1.y && currentY >= p2.y)
        ) {
          if (p1.y !== p2.y)
            endZ = p1.x + ((currentY - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x);
          break;
        }
      }
      sPts.push({ x: safeZ, y: currentY, type: "G00" });
      sPts.push({ x: endZ, y: currentY, type: "G01" });
      sPts.push({
        x: endZ + 0.5,
        y: currentY + (isInner ? -0.5 : 0.5),
        type: "G01",
      });
      sPts.push({
        x: safeZ,
        y: currentY + (isInner ? -0.5 : 0.5),
        type: "G00",
      });
      passes++;
    }
    sPts.push({ x: safeZ, y: activeCompPts[0].y, type: "G00" });
    activeCompPts.forEach((pt) => sPts.push({ ...pt, type: pt.type || "G01" }));
    sPts.push({ x: safeZ, y: safeY, type: "G00" });
    interactionRef.current.sim = { active: true, progress: 0, pts: sPts };
  };

  // --- 畫布渲染 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationFrameId; // 🔥 修正：建立變數來追蹤 requestAnimationFrame

    const render = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cameraRef.current.x, cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      if (bgImage) {
        ctx.globalAlpha = bgOpacity;
        ctx.drawImage(bgImage, -200, -200, 400, 400);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(
        -stock.length,
        -stock.od / 2,
        stock.length + Number(stock.face),
        (stock.od - stock.id) / 2
      );

      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1 / cameraRef.current.zoom;
      ctx.beginPath();
      for (let i = -500; i <= 500; i += 50) {
        ctx.moveTo(i, -500);
        ctx.lineTo(i, 500);
        ctx.moveTo(-500, i);
        ctx.lineTo(500, i);
      }
      ctx.stroke();
      ctx.strokeStyle = "#ff5722";
      ctx.beginPath();
      ctx.moveTo(0, -500);
      ctx.lineTo(0, 500);
      ctx.stroke();
      ctx.strokeStyle = "#007bff";
      ctx.beginPath();
      ctx.moveTo(-500, 0);
      ctx.lineTo(500, 0);
      ctx.stroke();
      drawCross(ctx, 0, 0, 20, "red", 2);

      visualPaths.forEach((p, idx) => {
        if (!p?.points || !Array.isArray(p.points)) return;
        const isActive = p.id === activePath?.id;
        const isHovered =
          p.id === interactionRef.current.hoveredPathId && mode === "SELECT";
        ctx.lineWidth =
          isActive || isHovered
            ? 2.5 / cameraRef.current.zoom
            : 1.5 / cameraRef.current.zoom;
        ctx.strokeStyle = isActive
          ? "#00ff00"
          : isHovered
          ? "#bfffbf"
          : "#4a824a";
        ctx.beginPath();
        p.points.forEach((pt, i) => {
          if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined")
            return;
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else if (pt.type === "arc")
            ctx.arc(
              pt.cx,
              pt.cy,
              pt.radius,
              pt.startAngle,
              pt.endAngle,
              !pt.ccw
            );
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        const cPts = visualCompPaths[idx]?.points;
        if (
          cPts &&
          Array.isArray(cPts) &&
          cPts.length > 0 &&
          !interactionRef.current.sim.active
        ) {
          ctx.beginPath();
          ctx.strokeStyle = isActive
            ? toolConfig.color
            : "rgba(0, 255, 255, 0.3)";
          ctx.setLineDash([4 / cameraRef.current.zoom]);
          cPts.forEach((pt, i) => {
            if (
              !pt ||
              typeof pt.x === "undefined" ||
              typeof pt.y === "undefined"
            )
              return;
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else if (pt.type === "arc" && pt.radius)
              ctx.arc(
                pt.cx,
                pt.cy,
                pt.radius,
                pt.startAngle,
                pt.endAngle,
                !pt.ccw
              );
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      paths.forEach((p) => {
        if (p.id !== activePath?.id || !p.points) return;
        p.points.forEach((pt) => {
          if (!pt || typeof pt.x === "undefined") return;
          drawCross(ctx, pt.x, pt.y, 5, "#fff");
          if (pt.c || pt.r) {
            ctx.fillStyle = "#ff00ff";
            ctx.font = `${12 / cameraRef.current.zoom}px Arial`;
            ctx.fillText(
              pt.c ? `C${pt.c}` : `R${pt.r}`,
              pt.x + 5 / cameraRef.current.zoom,
              pt.y - 5 / cameraRef.current.zoom
            );
          }
        });
      });

      const cur = interactionRef.current.currentPt;
      if (cur && typeof cur.x !== "undefined" && typeof cur.y !== "undefined") {
        if (mode === "DRAW_CIRCLE") {
          if (circleSubMode === "TAN") {
            const tangent = getTangentCircle(cur);
            interactionRef.current.tangentCircle = tangent;
            if (tangent) {
              ctx.setLineDash([5 / cameraRef.current.zoom]);
              ctx.strokeStyle = "#ffeb3b";
              ctx.beginPath();
              ctx.arc(tangent.cx, tangent.cy, tangent.r, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          } else if (
            circleSubMode === "CEN" &&
            interactionRef.current.circleStart
          ) {
            const r = Math.hypot(
              cur.x - interactionRef.current.circleStart.x,
              cur.y - interactionRef.current.circleStart.y
            );
            ctx.strokeStyle = "rgba(0,255,0,0.5)";
            ctx.beginPath();
            ctx.arc(
              interactionRef.current.circleStart.x,
              interactionRef.current.circleStart.y,
              r,
              0,
              Math.PI * 2
            );
            ctx.stroke();
          }
        }

        if (mode === "TRIM" && interactionRef.current.trimPath.length > 0) {
          ctx.strokeStyle = "#ff4444";
          ctx.lineWidth = 2 / cameraRef.current.zoom;
          ctx.beginPath();
          interactionRef.current.trimPath.forEach((p, i) => {
            if (p && typeof p.x !== "undefined")
              i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }

        let end = cur;
        if (
          isOrtho &&
          mode === "DRAW_LINE" &&
          interactionRef.current.continuous &&
          activePath?.points &&
          !interactionRef.current.isSnapped
        ) {
          const last = activePath.points[activePath.points.length - 1];
          if (last && typeof last.x !== "undefined") {
            end =
              Math.abs(cur.x - last.x) > Math.abs(cur.y - last.y)
                ? { x: cur.x, y: last.y }
                : { x: last.x, y: cur.y };
          }
        }

        if (
          mode === "DRAW_LINE" &&
          interactionRef.current.continuous &&
          activePath?.points
        ) {
          const lastPt = activePath.points[activePath.points.length - 1];
          if (lastPt && typeof lastPt.x !== "undefined") {
            ctx.save();
            ctx.setLineDash([5 / cameraRef.current.zoom]);
            ctx.strokeStyle =
              lineMode === "G00" ? "rgba(255,0,0,0.5)" : "rgba(0,255,0,0.5)";
            ctx.beginPath();
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            ctx.restore();
          }
        } else if (mode === "DRAW_ARC") {
          const aps = interactionRef.current.arcPts;
          ctx.save();
          ctx.setLineDash([5 / cameraRef.current.zoom]);
          ctx.strokeStyle = "rgba(0,255,0,0.5)";
          if (aps.length === 1 && aps[0]) {
            ctx.beginPath();
            ctx.moveTo(aps[0].x, aps[0].y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          } else if (aps.length === 2 && aps[0] && aps[1]) {
            try {
              const a =
                arcSubMode === "SCE"
                  ? calcSCE(aps[0], aps[1], end)
                  : calcSER(aps[0], aps[1], end);
              if (a && a.radius) {
                ctx.beginPath();
                ctx.arc(a.cx, a.cy, a.radius, a.startAngle, a.endAngle, a.ccw);
                ctx.stroke();
              }
            } catch (e) {}
          }
          ctx.restore();
        }

        const c =
          mode === "CHAMFER"
            ? "#ff00ff"
            : interactionRef.current.isSnapped
            ? "#ffeb3b"
            : mode === "SELECT"
            ? "#0dcaf0"
            : "#00ff00";
        ctx.strokeStyle = c;
        ctx.lineWidth = 1 / cameraRef.current.zoom;
        ctx.beginPath();
        ctx.moveTo(cur.x - 15 / cameraRef.current.zoom, cur.y);
        ctx.lineTo(cur.x + 15 / cameraRef.current.zoom, cur.y);
        ctx.moveTo(cur.x, cur.y - 15 / cameraRef.current.zoom);
        ctx.lineTo(cur.x, cur.y + 15 / cameraRef.current.zoom);
        ctx.stroke();

        const zDom = document.getElementById("coordZ");
        const xDom = document.getElementById("coordX");
        if (zDom)
          zDom.innerText = interactionRef.current.isSnapped
            ? "0.000"
            : end.x.toFixed(3);
        if (xDom)
          xDom.innerText = interactionRef.current.isSnapped
            ? "0.000"
            : (-end.y * 2).toFixed(3);
      }

      if (interactionRef.current.sim.active) {
        let sim = interactionRef.current.sim;
        sim.progress += 0.15;
        if (sim.progress >= sim.pts.length - 1) {
          sim.progress = sim.pts.length - 1;
          sim.active = false;
        }

        const idx = Math.floor(sim.progress);
        const nextIdx = Math.min(idx + 1, sim.pts.length - 1);
        const t = sim.progress - idx;
        const pt1 = sim.pts[idx];
        const pt2 = sim.pts[nextIdx];
        if (pt1 && pt2 && typeof pt1.x !== "undefined") {
          const curX = pt1.x + (pt2.x - pt1.x) * t;
          const curY = pt1.y + (pt2.y - pt1.y) * t;
          ctx.lineWidth = 2 / cameraRef.current.zoom;
          for (let i = 1; i <= idx; i++) {
            if (!sim.pts[i] || !sim.pts[i - 1]) continue;
            ctx.strokeStyle =
              sim.pts[i].type === "G00" ? "#ff4444" : toolConfig.color;
            ctx.setLineDash(
              sim.pts[i].type === "G00" ? [3 / cameraRef.current.zoom] : []
            );
            ctx.beginPath();
            ctx.moveTo(sim.pts[i - 1].x, sim.pts[i - 1].y);
            ctx.lineTo(sim.pts[i].x, sim.pts[i].y);
            ctx.stroke();
          }
          ctx.strokeStyle = pt2.type === "G00" ? "#ff4444" : toolConfig.color;
          ctx.setLineDash(
            pt2.type === "G00" ? [3 / cameraRef.current.zoom] : []
          );
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(curX, curY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = toolConfig.color;
          ctx.beginPath();
          const aRad = (toolConfig.angle / 2) * (Math.PI / 180);
          const dirY = isInner ? -1 : 1;
          const hL = 20 / cameraRef.current.zoom;
          ctx.moveTo(curX, curY);
          ctx.arc(curX, curY, toolConfig.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(curX, curY);
          ctx.lineTo(
            curX + Math.cos(aRad) * hL,
            curY + Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL + 15 / cameraRef.current.zoom,
            curY + Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL + 15 / cameraRef.current.zoom,
            curY - Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL,
            curY - Math.sin(aRad) * hL * dirY
          );
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "rgba(100, 100, 100, 0.8)";
          ctx.fillRect(
            curX + Math.cos(aRad) * hL,
            curY - (10 * dirY) / cameraRef.current.zoom,
            30 / cameraRef.current.zoom,
            (20 * dirY) / cameraRef.current.zoom
          );
        }
      }
      ctx.restore();
      
      // 🔥 修正：把回傳的 ID 存起來
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    
    // 🔥 修正：加上 cleanup function 確保不會產生無限疊加的無窮迴圈
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    visualPaths,
    activePath,
    stock,
    mode,
    circleSubMode,
    isOrtho,
    lineMode,
    arcSubMode,
    toolConfig,
    isInner,
  ]);

  // --- 事件處理 ---
  const handleMouseDown = (e) => {
    if (e.button === 2) {
      interactionRef.current.continuous = false;
      interactionRef.current.circleStart = null;
      interactionRef.current.arcPts = [];
      setPaths((p) => [...p]);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    let snapPt = rawPt;
    let isSnapped = false;
    if (Math.hypot(rawPt.x, rawPt.y) < 12 / cameraRef.current.zoom) {
      snapPt = { x: 0, y: 0 };
      isSnapped = true;
    }
    paths.forEach((p) => {
      if (p.points)
        p.points.forEach((pt) => {
          if (
            pt &&
            Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) <
              12 / cameraRef.current.zoom
          ) {
            snapPt = pt;
            isSnapped = true;
          }
        });
    });

    if (mode === "DRAW_CIRCLE") {
      if (circleSubMode === "TAN") {
        const tangent = interactionRef.current.tangentCircle;
        if (tangent) {
          saveState();
          const pts = [];
          for (let a = 0; a <= 360; a += 5)
            pts.push({
              x: tangent.cx + Math.cos((a * Math.PI) / 180) * tangent.r,
              y: tangent.cy + Math.sin((a * Math.PI) / 180) * tangent.r,
              type: "G01",
              c: 0,
              r: 0,
            });
          setPaths((prev) => [...prev, { id: Date.now(), points: pts }]);
        }
      } else if (circleSubMode === "CEN") {
        if (!interactionRef.current.circleStart) {
          interactionRef.current.circleStart = snapPt;
        } else {
          saveState();
          const r = Math.hypot(
            snapPt.x - interactionRef.current.circleStart.x,
            snapPt.y - interactionRef.current.circleStart.y
          );
          if (r > 0.01) {
            const cx = interactionRef.current.circleStart.x,
              cy = interactionRef.current.circleStart.y;
            const pts = [];
            for (let a = 0; a <= 360; a += 5)
              pts.push({
                x: cx + Math.cos((a * Math.PI) / 180) * r,
                y: cy + Math.sin((a * Math.PI) / 180) * r,
                type: "G01",
                c: 0,
                r: 0,
              });
            setPaths((prev) => [...prev, { id: Date.now(), points: pts }]);
          }
          interactionRef.current.circleStart = null;
        }
      }
      return;
    }

    if (mode === "PAN") {
      interactionRef.current.isDragging = true;
      interactionRef.current.lastMouse = { x: e.clientX, y: e.clientY };
    } else if (mode === "SELECT") {
      if (interactionRef.current.hoveredPathId)
        setSelectedPathId(interactionRef.current.hoveredPathId);
    } else if (mode === "TRIM") {
      interactionRef.current.isDragging = true;
      interactionRef.current.trimPath = [rawPt];
    } else if (mode === "CHAMFER") {
      const hc = interactionRef.current.hoveredCorner;
      if (hc) {
        saveState();
        setPaths((prev) => {
          const n = [...prev];
          n[hc.pIdx].points[hc.ptIdx][chamferType] = chamferVal;
          return n;
        });
      }
    } else if (mode === "DRAW_LINE") {
      saveState();
      let end = snapPt;
      let autoJoined = false;
      if (!interactionRef.current.continuous && isSnapped) {
        setPaths((prev) => {
          let n = [...prev];
          for (let i = 0; i < n.length; i++) {
            if (!n[i].points || n[i].points.length === 0) continue;
            const lastPt = n[i].points[n[i].points.length - 1];
            if (
              lastPt &&
              Math.hypot(end.x - lastPt.x, end.y - lastPt.y) < 0.001
            ) {
              setSelectedPathId(n[i].id);
              autoJoined = true;
              break;
            }
          }
          return n;
        });
        if (autoJoined) {
          interactionRef.current.continuous = true;
          return;
        }
      }
      if (
        isOrtho &&
        interactionRef.current.continuous &&
        activePath &&
        !isSnapped
      ) {
        const last = activePath.points[activePath.points.length - 1];
        if (last)
          end =
            Math.abs(snapPt.x - last.x) > Math.abs(snapPt.y - last.y)
              ? { x: snapPt.x, y: last.y }
              : { x: last.x, y: snapPt.y };
      }
      setPaths((prev) => {
        let n = [...prev];
        if (!interactionRef.current.continuous || n.length === 0) {
          const id = Date.now();
          n.push({ id, points: [{ ...end, type: lineMode, c: 0, r: 0 }] });
          setSelectedPathId(id);
        } else {
          const idx = n.findIndex((p) => p.id === activePath?.id);
          if (idx !== -1)
            n[idx].points.push({ ...end, type: lineMode, c: 0, r: 0 });
        }
        return n;
      });
      interactionRef.current.continuous = true;
    } else if (mode === "DRAW_ARC") {
      let aps = interactionRef.current.arcPts;
      if (aps.length === 0 && interactionRef.current.continuous && activePath)
        aps.push(activePath.points[activePath.points.length - 1]);
      aps.push(snapPt);
      if (aps.length === 3) {
        saveState();
        const a =
          arcSubMode === "SCE"
            ? calcSCE(aps[0], aps[1], aps[2])
            : calcSER(aps[0], aps[1], aps[2]);
        if (a) {
          setPaths((prev) => {
            let n = [...prev];
            const pathIdx = n.findIndex((p) => p.id === activePath?.id);
            if (pathIdx === -1 || !interactionRef.current.continuous) {
              const newId = Date.now();
              n.push({
                id: newId,
                points: [aps[0], { ...aps[2], type: "arc", ...a, c: 0, r: 0 }],
              });
              setSelectedPathId(newId);
            } else {
              n[pathIdx].points.push({
                ...aps[2],
                type: "arc",
                ...a,
                c: 0,
                r: 0,
              });
            }
            return n;
          });
          interactionRef.current.continuous = true;
          setMode("DRAW_LINE");
        }
        interactionRef.current.arcPts = [];
      } else {
        interactionRef.current.arcPts = aps;
      }
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (e.clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (e.clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    let snapPt = rawPt;
    let isSnapped = false;
    if (Math.hypot(rawPt.x, rawPt.y) < 12 / cameraRef.current.zoom) {
      snapPt = { x: 0, y: 0 };
      isSnapped = true;
    }
    paths.forEach((p) => {
      if (p.points)
        p.points.forEach((pt) => {
          if (
            pt &&
            Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) <
              12 / cameraRef.current.zoom
          ) {
            snapPt = pt;
            isSnapped = true;
          }
        });
    });

    interactionRef.current.currentPt = snapPt;
    interactionRef.current.isSnapped = isSnapped;

    if (mode === "SELECT") {
      let minD = 20 / cameraRef.current.zoom,
        foundId = null;
      paths.forEach((p) => {
        if (p.points)
          p.points.forEach((pt) => {
            if (pt && Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) < minD)
              foundId = p.id;
          });
      });
      interactionRef.current.hoveredPathId = foundId;
    } else {
      interactionRef.current.hoveredPathId = null;
    }

    if (mode === "CHAMFER") {
      let minD = 20 / cameraRef.current.zoom,
        found = null;
      paths.forEach((p, pIdx) => {
        if (!p.points) return;
        for (let i = 1; i < p.points.length - 1; i++) {
          const pt = p.points[i];
          if (pt && Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) < minD) {
            minD = Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y);
            found = { pIdx, ptIdx: i };
          }
        }
      });
      interactionRef.current.hoveredCorner = found;
    } else {
      interactionRef.current.hoveredCorner = null;
    }

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
            const p1 = path.points[i],
              p2 = path.points[i + 1];
            if (!p1 || !p2) continue;
            let inters = [];
            allSegs.forEach((seg) => {
              const I = checkIntersect(p1, p2, seg.A, seg.B, false);
              if (I) inters.push(I);
            });
            inters.sort(
              (a, b) =>
                Math.hypot(a.x - p1.x, a.y - p1.y) -
                Math.hypot(b.x - p1.x, b.y - p1.y)
            );

            let uniqueInters = [];
            inters.forEach((I) => {
              if (
                uniqueInters.length === 0 ||
                Math.hypot(
                  I.x - uniqueInters[uniqueInters.length - 1].x,
                  I.y - uniqueInters[uniqueInters.length - 1].y
                ) > 0.001
              )
                uniqueInters.push(I);
            });

            let microPts = [p1, ...uniqueInters, p2];
            for (let k = 0; k < microPts.length - 1; k++) {
              const m1 = microPts[k],
                m2 = microPts[k + 1];
              let cut = false;
              for (let j = 0; j < tPath.length - 1; j++)
                if (checkIntersect(m1, m2, tPath[j], tPath[j + 1], true)) {
                  cut = true;
                  break;
                }

              if (cut) {
                if (cur.length > 0) {
                  cur.push({ ...m1, type: p2.type });
                  newPaths.push({ id: Math.random(), points: cur });
                  cur = [];
                }
              } else {
                if (cur.length === 0)
                  cur.push({
                    ...m1,
                    type: k === 0 ? p1.type : p2.type,
                    c: p1.c,
                    r: p1.r,
                  });
                if (k === microPts.length - 2)
                  cur.push({ ...m2, type: p2.type, c: 0, r: 0 });
              }
            }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths
          .map((p) => ({
            ...p,
            points: p.points.filter(
              (pt, idx, arr) =>
                pt &&
                (idx === 0 ||
                  Math.hypot(pt.x - arr[idx - 1].x, pt.y - arr[idx - 1].y) >
                    0.001)
            ),
          }))
          .filter((p) => p.points && p.points.length > 1);
      });
    }
    interactionRef.current.isDragging = false;
    interactionRef.current.trimPath = [];
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#1e1e1e",
        color: "white",
        overflow: "hidden",
      }}
    >
      <div style={{ flexGrow: 1, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            cursor: "none",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={(e) => {
            const z = e.deltaY > 0 ? 0.85 : 1.15;
            cameraRef.current.zoom = Math.max(
              0.01,
              Math.min(cameraRef.current.zoom * z, 150)
            );
          }}
          onContextMenu={(e) => e.preventDefault()}
        />

        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            display: "flex",
            gap: "5px",
            background: "rgba(0,0,0,0.7)",
            padding: "10px",
            borderRadius: "8px",
            flexWrap: "wrap",
            maxWidth: "85%",
          }}
        >
          <button
            onClick={handleUndo}
            style={{
              background: "#ff9800",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            ↩ 復原 (Ctrl+Z)
          </button>

          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "#333",
              padding: "2px",
              borderRadius: "4px",
            }}
          >
            <button
              onClick={() => setMode("SELECT")}
              style={{
                background: mode === "SELECT" ? "#0dcaf0" : "#444",
                color: mode === "SELECT" ? "#000" : "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              👆 選取
            </button>
            <button
              onClick={() => setMode("PAN")}
              style={{
                background: mode === "PAN" ? "#007bff" : "#444",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              ✋ 平移
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "#333",
              padding: "2px",
              borderRadius: "4px",
            }}
          >
            <button
              onClick={() => {
                setMode("DRAW_LINE");
                setLineMode("G01");
              }}
              style={{
                background:
                  mode === "DRAW_LINE" && lineMode === "G01"
                    ? "#28a745"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              ✏️ 直線(G01)
            </button>
            <button
              onClick={() => {
                setMode("DRAW_LINE");
                setLineMode("G00");
              }}
              style={{
                background:
                  mode === "DRAW_LINE" && lineMode === "G00"
                    ? "#dc3545"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🚀 快移(G00)
            </button>
          </div>

          <button
            onClick={() => {
              interactionRef.current.continuous = false;
              interactionRef.current.arcPts = [];
              setPaths((p) => [...p]);
            }}
            style={{
              background: "#e83e8c",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            🏁 斷開(Esc)
          </button>

          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "#333",
              padding: "2px",
              borderRadius: "4px",
            }}
          >
            <button
              onClick={() => {
                setMode("DRAW_ARC");
                setArcSubMode("SCE");
                interactionRef.current.arcPts = [];
              }}
              style={{
                background:
                  mode === "DRAW_ARC" && arcSubMode === "SCE"
                    ? "#e83e8c"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              弧:起中端
            </button>
            <button
              onClick={() => {
                setMode("DRAW_ARC");
                setArcSubMode("SER");
                interactionRef.current.arcPts = [];
              }}
              style={{
                background:
                  mode === "DRAW_ARC" && arcSubMode === "SER"
                    ? "#e83e8c"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              弧:起端半
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "#333",
              padding: "2px",
              borderRadius: "4px",
            }}
          >
            <button
              onClick={() => {
                setMode("DRAW_CIRCLE");
                setCircleSubMode("CEN");
                interactionRef.current.circleStart = null;
              }}
              style={{
                background:
                  mode === "DRAW_CIRCLE" && circleSubMode === "CEN"
                    ? "#e83e8c"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px 10px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🔴 圓:中心
            </button>
            <button
              onClick={() => {
                setMode("DRAW_CIRCLE");
                setCircleSubMode("TAN");
                interactionRef.current.tangentCircle = null;
              }}
              style={{
                background:
                  mode === "DRAW_CIRCLE" && circleSubMode === "TAN"
                    ? "#e83e8c"
                    : "#444",
                color: "#fff",
                border: "none",
                padding: "6px 10px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🔴 圓:相切
            </button>
          </div>

          <button
            onClick={() => setMode("TRIM")}
            style={{
              background: mode === "TRIM" ? "#ff4444" : "#444",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            ✂️ 修剪
          </button>

          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "#333",
              padding: "2px",
              borderRadius: "4px",
            }}
          >
            <button
              onClick={() => setMode("CHAMFER")}
              style={{
                background: mode === "CHAMFER" ? "#ffeb3b" : "#444",
                color: mode === "CHAMFER" ? "#000" : "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              🔨 倒角
            </button>
            {mode === "CHAMFER" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "0 5px",
                }}
              >
                <select
                  value={chamferType}
                  onChange={(e) => setChamferType(e.target.value)}
                  style={{
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    padding: "4px",
                    fontSize: "11px",
                  }}
                >
                  <option value="c">C角</option>
                  <option value="r">R角</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={chamferVal}
                  onChange={(e) => setChamferVal(Number(e.target.value))}
                  style={{
                    width: "40px",
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    padding: "4px",
                  }}
                />
              </div>
            )}
          </div>

          <button
            onClick={() => {
              saveState();
              setPaths([]);
            }}
            style={{
              background: "#6c757d",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            ✖ 清除
          </button>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "12px",
              marginLeft: "5px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={isOrtho}
              onChange={(e) => setIsOrtho(e.target.checked)}
            />{" "}
            📐 正交
          </label>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0,0,0,0.6)",
            padding: "8px",
            borderRadius: "4px",
            color: "#00ff00",
            fontFamily: "monospace",
            fontSize: "13px",
          }}
        >
          Z: <span id="coordZ">0.000</span> / X(直):{" "}
          <span id="coordX">0.000</span>
        </div>
      </div>

      <div
        style={{
          width: "400px",
          background: "#252526",
          padding: "20px",
          borderLeft: "1px solid #444",
          overflowY: "auto",
        }}
      >
        <h3 style={{ color: "#00FFFF", marginTop: 0 }}>📦 參數與安全距離</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "8px",
            marginBottom: "15px",
          }}
        >
          {/* 🔥 修正：所有綁定到數值的 Input 加上 Number() 強制轉型 */}
          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>外徑 OD</label>
            <input
              type="number"
              value={stock.od}
              onChange={(e) => setStock({ ...stock, od: Number(e.target.value) || 0 })}
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>內徑 ID</label>
            <input
              type="number"
              value={stock.id}
              onChange={(e) => setStock({ ...stock, id: Number(e.target.value) || 0 })}
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>長度 L</label>
            <input
              type="number"
              value={stock.length}
              onChange={(e) => setStock({ ...stock, length: Number(e.target.value) || 0 })}
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: "11px", color: "#ffeb3b" }}>
              端面預留 Z
            </label>
            <input
              type="number"
              step="0.1"
              value={stock.face}
              onChange={(e) =>
                setStock({ ...stock, face: parseFloat(e.target.value) || 0 })
              }
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "1px solid #ffeb3b",
                padding: "4px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>
              粗車深 DOC
            </label>
            <input
              type="number"
              step="0.1"
              value={cam.doc}
              onChange={(e) =>
                setCam({ ...cam, doc: parseFloat(e.target.value) || 0 })
              }
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>進給 F</label>
            <input
              type="number"
              step="0.05"
              value={cam.feed}
              onChange={(e) =>
                setCam({ ...cam, feed: parseFloat(e.target.value) || 0 })
              }
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: "11px", color: "#ccc" }}>轉速 G50</label>
            <input
              type="number"
              value={cam.g50}
              onChange={(e) => setCam({ ...cam, g50: Number(e.target.value) || 0 })}
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#0dcaf0" }}>
              X預留(U)
            </label>
            <input
              type="number"
              step="0.1"
              value={cam.allowX}
              onChange={(e) =>
                setCam({ ...cam, allowX: parseFloat(e.target.value) || 0 })
              }
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "1px solid #0dcaf0",
                padding: "4px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#0dcaf0" }}>
              Z預留(W)
            </label>
            <input
              type="number"
              step="0.1"
              value={cam.allowZ}
              onChange={(e) =>
                setCam({ ...cam, allowZ: parseFloat(e.target.value) || 0 })
              }
              style={{
                width: "100%",
                background: "#111",
                color: "#fff",
                border: "1px solid #0dcaf0",
                padding: "4px",
              }}
            />
          </div>
        </div>

        <button
          onClick={() => setIsInner(!isInner)}
          style={{
            width: "100%",
            padding: "10px",
            background: isInner ? "#e83e8c" : "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            marginBottom: "15px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          加工方位：{isInner ? "內徑模式 (ID)" : "外徑模式 (OD)"}
        </button>

        <h4
          style={{ color: "#ffeb3b", fontSize: "13px", margin: "10px 0 5px 0" }}
        >
          ⚔️ 刀片設定
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "5px",
            marginBottom: "15px",
            background: "#111",
            padding: "10px",
            borderRadius: "4px",
            border: "1px solid #333",
          }}
        >
          <div>
            <label style={{ fontSize: "11px", color: "#aaa" }}>刀號</label>
            <input
              type="text"
              value={toolConfig.code}
              onChange={(e) =>
                setToolConfig({ ...toolConfig, code: e.target.value })
              }
              style={{
                width: "100%",
                background: "#222",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#aaa" }}>R角</label>
            <input
              type="number"
              step="0.1"
              value={toolConfig.r}
              onChange={(e) =>
                setToolConfig({
                  ...toolConfig,
                  r: parseFloat(e.target.value) || 0,
                })
              }
              style={{
                width: "100%",
                background: "#222",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "#aaa" }}>角度(°)</label>
            <select
              value={toolConfig.angle}
              onChange={(e) =>
                setToolConfig({
                  ...toolConfig,
                  angle: parseInt(e.target.value),
                })
              }
              style={{
                width: "100%",
                background: "#222",
                color: "#fff",
                border: "none",
                padding: "5px",
              }}
            >
              <option value="35">VNMG(35)</option>
              <option value="55">DNMG(55)</option>
              <option value="80">CNMG(80)</option>
            </select>
          </div>
        </div>

        <button
          onClick={solidifyFeatures}
          style={{
            width: "100%",
            padding: "10px",
            background: "#17a2b8",
            color: "white",
            border: "none",
            borderRadius: "4px",
            marginBottom: "10px",
            fontWeight: "bold",
          }}
        >
          🔨 實體化所有倒角
        </button>
        <button
          onClick={genGCode}
          style={{
            width: "100%",
            padding: "15px",
            background: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontWeight: "bold",
            fontSize: "16px",
          }}
        >
          🚀 產生 G-Code
        </button>
        <textarea
          value={gcode}
          readOnly
          style={{
            width: "100%",
            height: "300px",
            marginTop: "15px",
            background: "#000",
            color: "#00ff00",
            fontFamily: "monospace",
            fontSize: "11px",
            border: "1px solid #444",
          }}
        />
      </div>
    </div>
  );
};

export default function App() {
  return <CncWorkspace />;
}
