import { useEffect, useRef } from 'react';

type Props = {
  x: number;
  y: number;
  enabled: boolean;
  color?: string;
};

const palette = {
  glow: 'rgba(13, 111, 255, 0.45)',
  glowMid: 'rgba(52, 120, 246, 0.22)',
  core: '#ffffff'
};

export function CursorTrail({ x, y, enabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef({ x, y });
  const jointsRef = useRef<{ x: number; y: number }[]>([]);
  const animationFrameId = useRef<number | null>(null);
  const isLoopActive = useRef<boolean>(false);

  const tickRef = useRef<() => void>();

  // Update target ref whenever props change
  useEffect(() => {
    targetRef.current = { x, y };
  }, [x, y]);

  // Wake up loop on pointer movement
  useEffect(() => {
    if (!enabled) return;
    if (!isLoopActive.current) {
      isLoopActive.current = true;
      tickRef.current?.();
    }
  }, [x, y, enabled]);

  // Manage loop lifecycle, resizing and cleanup
  useEffect(() => {
    if (!enabled) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      isLoopActive.current = false;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      jointsRef.current = [];
      return;
    }

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initial wakeup
    if (!isLoopActive.current) {
      isLoopActive.current = true;
      tickRef.current?.();
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      isLoopActive.current = false;
    };
  }, [enabled]);

  // Define tick function reference to avoid hook dependency array issues
  tickRef.current = () => {
    if (!enabled || !isLoopActive.current) return;

    const canvas = canvasRef.current;
    if (!canvas) {
      animationFrameId.current = requestAnimationFrame(() => tickRef.current?.());
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animationFrameId.current = requestAnimationFrame(() => tickRef.current?.());
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);

    const target = targetRef.current;

    // Initialize chain of joints at target if not set
    if (jointsRef.current.length === 0) {
      jointsRef.current = Array.from({ length: 22 }, () => ({ x: target.x, y: target.y }));
    }

    const joints = jointsRef.current;
    if (joints[0]) {
      joints[0].x = target.x;
      joints[0].y = target.y;
    }

    // Update joint chain follow physics
    for (let i = 1; i < joints.length; i++) {
      const joint = joints[i];
      const prevJoint = joints[i - 1];
      if (joint && prevJoint) {
        const dx = prevJoint.x - joint.x;
        const dy = prevJoint.y - joint.y;
        const stiffness = 0.36 + 0.14 * (1 - i / joints.length);
        joint.x += dx * stiffness;
        joint.y += dy * stiffness;
      }
    }

    // Draw elements
    drawRibbon(ctx, joints);

    // Smart auto-sleep condition checking
    let canSleep = true;
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      if (joint) {
        const distSq = (joint.x - target.x) ** 2 + (joint.y - target.y) ** 2;
        if (distSq > 0.08) {
          canSleep = false;
          break;
        }
      }
    }

    if (canSleep) {
      ctx.clearRect(0, 0, width, height);
      isLoopActive.current = false;
      animationFrameId.current = null;
    } else {
      animationFrameId.current = requestAnimationFrame(() => tickRef.current?.());
    }
  };

  const drawRibbon = (ctx: CanvasRenderingContext2D, joints: { x: number; y: number }[]) => {
    if (joints.length < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const drawLayer = (strokeColor: string, maxStrokeWidth: number, alpha: number) => {
      ctx.strokeStyle = strokeColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha;

      for (let i = 0; i < joints.length - 1; i++) {
        const p1 = joints[i];
        const p2 = joints[i + 1];
        if (!p1 || !p2) continue;

        const ratio = 1 - i / (joints.length - 1);
        const width = maxStrokeWidth * Math.pow(ratio, 1.25);
        if (width < 0.25) continue;

        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    };

    // Layer 1: Wide soft outer glow
    drawLayer(palette.glow, 25, 0.4);
    drawLayer(palette.glowMid, 13, 0.5);

    // Layer 2: Core neon beam
    drawLayer(palette.glow, 6.5, 0.85);

    // Layer 3: Solid white inner core
    drawLayer(palette.core, 2.2, 0.98);

    ctx.restore();
  };

  return <canvas ref={canvasRef} className="cursor-trail" style={{ pointerEvents: 'none' }} />;
}
