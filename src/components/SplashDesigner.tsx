import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Copy, 
  Check, 
  Smartphone, 
  Sliders, 
  Code as CodeIcon,
  Play, 
  Pause, 
  RefreshCw, 
  FileText,
  Package,
  Cpu,
  Bookmark
} from 'lucide-react';
import { Language, AppSettings } from '../types';
import { translations } from '../translations';
import { toast } from 'sonner';

interface SplashDesignerProps {
  language: Language;
  settings: AppSettings;
}

type ShapeType = 'cube' | 'prism' | 'octahedron' | 'dodecahedron';

export default function SplashDesigner({ language, settings }: SplashDesignerProps) {
  const isRtl = language === 'ar';
  const t = translations[language];

  // Control parameters for the 3D Splash simulation
  const [shape, setShape] = useState<ShapeType>('octahedron');
  const [rotationSpeed, setRotationSpeed] = useState<number>(1.2);
  const [pulseFreq, setPulseFreq] = useState<number>(0.8);
  const [lightIntensity, setLightIntensity] = useState<number>(1.5);
  const [lightColor, setLightColor] = useState<string>('#6336f1'); // Indigo accent
  const [metallicFinish, setMetallicFinish] = useState<number>(0.9); // Metallic specular exponent
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isAnimating, setIsAnimating] = useState<boolean>(true);
  const [selectedSdk, setSelectedSdk] = useState<'rn' | 'flutter'>('rn');
  const [copied, setCopied] = useState<boolean>(false);

  // References for rendering canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);
  const rotationAngle = useRef<number>(0);
  const pulseTime = useRef<number>(0);

  // Preset Configurations
  const presets = [
    {
      name: isRtl ? 'أزرق صناعي دافئ' : 'Deep Cyber Blue',
      shape: 'octahedron' as ShapeType,
      speed: 1.5,
      pulse: 1.0,
      lightInt: 1.8,
      color: '#06b6d4', // Cyan
      metallic: 0.95,
    },
    {
      name: isRtl ? 'بلاتين حديث مذهل' : 'Platinum Slate',
      shape: 'prism' as ShapeType,
      speed: 1.0,
      pulse: 0.6,
      lightInt: 1.4,
      color: '#4f46e5', // Indigo
      metallic: 0.9,
    },
    {
      name: isRtl ? 'الذهب الفاخر الكلاسيكي' : 'Glossy Gold Enterprise',
      shape: 'dodecahedron' as ShapeType,
      speed: 0.8,
      pulse: 0.5,
      lightInt: 2.0,
      color: '#eab308', // Gold / Amber
      metallic: 1.0,
    },
    {
      name: isRtl ? 'مستودعي إميرالد' : 'Emerald Matrix',
      shape: 'cube' as ShapeType,
      speed: 1.3,
      pulse: 1.2,
      lightInt: 1.6,
      color: '#10b981', // Emerald
      metallic: 0.8,
    }
  ];

  const applyPreset = (preset: typeof presets[0]) => {
    setShape(preset.shape);
    setRotationSpeed(preset.speed);
    setPulseFreq(preset.pulse);
    setLightIntensity(preset.lightInt);
    setLightColor(preset.color);
    setMetallicFinish(preset.metallic);
    toast.success(isRtl ? `تم تطبيق مظهر ${preset.name} بنجاح` : `Applied preset: ${preset.name}`);
  };

  // Canvas 3D Geometric Logo rendering loop (fully custom mathematical rotation projection)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let localAngle = rotationAngle.current;
    let localPulse = pulseTime.current;

    interface Point3D {
      x: number;
      y: number;
      z: number;
    }

    interface Face {
      indexes: number[];
      normal?: Point3D;
      color?: string;
    }

    // Mathematical definition of high-fidelity shapes with sharp, rigid edges:
    const getVertices = (type: ShapeType): Point3D[] => {
      if (type === 'cube') {
        const size = 60;
        return [
          { x: -size, y: -size, z: -size },
          { x: size, y: -size, z: -size },
          { x: size, y: size, z: -size },
          { x: -size, y: size, z: -size },
          { x: -size, y: -size, z: size },
          { x: size, y: -size, z: size },
          { x: size, y: size, z: size },
          { x: -size, y: size, z: size }
        ];
      } else if (type === 'octahedron') {
        const r = 85;
        return [
          { x: 0, y: -r, z: 0 },   // Top
          { x: r, y: 0, z: 0 },    // Right
          { x: 0, y: 0, z: r },    // Front
          { x: -r, y: 0, z: 0 },   // Left
          { x: 0, y: 0, z: -r },   // Back
          { x: 0, y: r, z: 0 }     // Bottom
        ];
      } else if (type === 'prism') {
        // High fidelity triangular prism
        const h = 75;
        const r = 60;
        return [
          // Base 1 (Z = -60)
          { x: 0, y: -r, z: -h },
          { x: r * 0.866, y: r * 0.5, z: -h },
          { x: -r * 0.866, y: r * 0.5, z: -h },
          // Base 2 (Z = 60)
          { x: 0, y: -r, z: h },
          { x: r * 0.866, y: r * 0.5, z: h },
          { x: -r * 0.866, y: r * 0.5, z: h }
        ];
      } else {
        // Golden Ratio Dodecahedron for a highly corporate geometric logo
        const phi = (1 + Math.sqrt(5)) / 2;
        const a = 36;
        const b = 36 / phi;
        const c = 36 * phi;
        return [
          { x: -a, y: -a, z: -a }, { x: a, y: -a, z: -a }, { x: a, y: a, z: -a }, { x: -a, y: a, z: -a },
          { x: -a, y: -a, z: a }, { x: a, y: -a, z: a }, { x: a, y: a, z: a }, { x: -a, y: a, z: a },
          { x: 0, y: -b, z: -c }, { x: 0, y: b, z: -c }, { x: 0, y: b, z: c }, { x: 0, y: -b, z: c },
          { x: -b, y: -c, z: 0 }, { x: b, y: -c, z: 0 }, { x: b, y: c, z: 0 }, { x: -b, y: c, z: 0 },
          { x: -c, y: 0, z: -b }, { x: c, y: 0, z: -b }, { x: c, y: 0, z: b }, { x: -c, y: 0, z: b }
        ];
      }
    };

    const getFaces = (type: ShapeType): Face[] => {
      if (type === 'cube') {
        return [
          { indexes: [0, 1, 2, 3] }, // Back
          { indexes: [4, 5, 6, 7] }, // Front
          { indexes: [0, 1, 5, 4] }, // Bottom
          { indexes: [2, 3, 7, 6] }, // Top
          { indexes: [0, 3, 7, 4] }, // Left
          { indexes: [1, 2, 6, 5] }  // Right
        ];
      } else if (type === 'octahedron') {
        return [
          { indexes: [0, 1, 2] }, { indexes: [0, 2, 3] },
          { indexes: [0, 3, 4] }, { indexes: [0, 4, 1] },
          { indexes: [5, 2, 1] }, { indexes: [5, 3, 2] },
          { indexes: [5, 4, 3] }, { indexes: [5, 1, 4] }
        ];
      } else if (type === 'prism') {
        return [
          { indexes: [0, 1, 2] }, // bottom triangle
          { indexes: [3, 4, 5] }, // top triangle
          { indexes: [0, 1, 4, 3] }, // face 1
          { indexes: [1, 2, 5, 4] }, // face 2
          { indexes: [2, 0, 3, 5] }  // face 3
        ];
      } else {
        return [
          { indexes: [0, 8, 9, 3, 16] },
          { indexes: [0, 12, 13, 1, 8] },
          { indexes: [1, 17, 2, 9, 8] },
          { indexes: [2, 14, 15, 3, 9] },
          { indexes: [3, 15, 12, 0, 16] },
          { indexes: [4, 11, 10, 7, 19] },
          { indexes: [4, 12, 13, 5, 11] },
          { indexes: [5, 18, 6, 10, 11] },
          { indexes: [6, 14, 15, 7, 10] },
          { indexes: [7, 19, 12, 4, 15] },
          { indexes: [8, 1, 13, 5, 11] },
          { indexes: [2, 17, 18, 6, 14] }
        ];
      }
    };

    // Helper to rotate vector in 3D Space (Studio Spotlights)
    const rotateX = (p: Point3D, angle: number): Point3D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: p.x,
        y: p.y * cos - p.z * sin,
        z: p.y * sin + p.z * cos
      };
    };

    const rotateY = (p: Point3D, angle: number): Point3D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: p.x * cos + p.z * sin,
        y: p.y,
        z: -p.x * sin + p.z * cos
      };
    };

    const rotateZ = (p: Point3D, angle: number): Point3D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos,
        z: p.z
      };
    };

    const render = () => {
      if (!ctx || !canvas) return;

      const width = canvas.width;
      const height = canvas.height;
      const originX = width / 2;
      const originY = height / 2 - 25; // slightly center biased

      // Clear with elegant dark slate tech theme gradient
      ctx.fillStyle = '#0f172a'; // slate-900
      ctx.fillRect(0, 0, width, height);

      // Render futuristic coordinate grid floor lines
      if (showGrid) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)'; // Indigo accents grid
        ctx.lineWidth = 1;
        
        const gridY = height * 0.78;
        const numLines = 14;
        
        // Horizontal lines projecting to perspective vanishing point
        for (let i = 0; i < 7; i++) {
          const ratio = i / 6;
          const currY = gridY + ratio * (height - gridY);
          ctx.beginPath();
          ctx.moveTo(0, currY);
          ctx.lineTo(width, currY);
          ctx.lineWidth = 1 + ratio * 1.5;
          ctx.strokeStyle = `rgba(99, 102, 241, ${0.05 + ratio * 0.09})`;
          ctx.stroke();
        }

        // Perspective grid ray lines
        for (let i = -numLines; i <= numLines; i++) {
          const startX = originX + i * 22;
          const endX = originX + i * 140; 
          ctx.beginPath();
          ctx.moveTo(startX, gridY);
          ctx.lineTo(endX, height);
          ctx.strokeStyle = `rgba(99, 102, 241, 0.08)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Compute physical scaling using responsive breathing pulse
      let pulseScale = 1.0;
      if (isAnimating) {
        localPulse += 0.015 * pulseFreq;
        pulseTime.current = localPulse;
      }
      pulseScale = 1.0 + Math.sin(localPulse) * 0.045; // Subtle enterprise corporate shrink-and-grow pulse

      // Rotate geometric angles
      if (isAnimating) {
        localAngle += 0.01 * rotationSpeed;
        rotationAngle.current = localAngle;
      }

      const vertices = getVertices(shape);
      const faces = getFaces(shape);

      // Apply 3D matrix transformation to vertices
      const transformedVertices = vertices.map(v => {
        // Apply breathing pulse scaling
        let scaled = { x: v.x * pulseScale, y: v.y * pulseScale, z: v.z * pulseScale };
        // Rotate continuous 360-degree rotation (simultaneous pitch/yaw)
        let r = rotateY(scaled, localAngle);
        r = rotateX(r, localAngle * 0.45);
        r = rotateZ(r, 0.22); // steady isometric offset tilt
        return r;
      });

      // Simple perspective depth ordering projection (Painter's algorithm)
      const faceDepths = faces.map((face, index) => {
        let avgZ = 0;
        face.indexes.forEach(idx => {
          avgZ += transformedVertices[idx].z;
        });
        avgZ /= face.indexes.length;
        return { index, depth: avgZ };
      });

      // Sort with respect to painter depth values
      faceDepths.sort((a, b) => b.depth - a.depth);

      // Studio dynamic spotlights calculation
      const spotlightDir: Point3D = { x: -0.5, y: -0.8, z: 1.2 };
      const lenSpotlight = Math.sqrt(spotlightDir.x*spotlightDir.x + spotlightDir.y*spotlightDir.y + spotlightDir.z*spotlightDir.z);
      const spotlightNormalized = { x: spotlightDir.x/lenSpotlight, y: spotlightDir.y/lenSpotlight, z: spotlightDir.z/lenSpotlight };

      faceDepths.forEach(fd => {
        const face = faces[fd.index];
        const v = face.indexes.map(idx => transformedVertices[idx]);

        // Calculate face triangle normal vector
        const sideA = { x: v[1].x - v[0].x, y: v[1].y - v[0].y, z: v[1].z - v[0].z };
        const sideB = { x: v[2].x - v[0].x, y: v[2].y - v[0].y, z: v[2].z - v[0].z };
        
        const normalVec = {
          x: sideA.y * sideB.z - sideA.z * sideB.y,
          y: sideA.z * sideB.x - sideA.x * sideB.z,
          z: sideA.x * sideB.y - sideA.y * sideB.x
        };

        const lenNormal = Math.sqrt(normalVec.x*normalVec.x + normalVec.y*normalVec.y + normalVec.z*normalVec.z);
        if (lenNormal === 0) return;

        const normal = { x: normalVec.x/lenNormal, y: normalVec.y/lenNormal, z: normalVec.z/lenNormal };

        // Backface culling (if facing away, do not render to clean graphics pipeline)
        if (normal.z < -0.15) return;

        // Diffuse Lambertian component with studio lighting intensity
        const dotProd = normal.x * spotlightNormalized.x + normal.y * spotlightNormalized.y + normal.z * spotlightNormalized.z;
        const diffuseIntensity = Math.max(0, dotProd);

        // Specular highlight component (Glossy metallic finish with sharp, rigid edges)
        const reflectVec = {
          x: 2 * diffuseIntensity * normal.x - spotlightNormalized.x,
          y: 2 * diffuseIntensity * normal.y - spotlightNormalized.y,
          z: 2 * diffuseIntensity * normal.z - spotlightNormalized.z
        };
        const specularIntensity = Math.pow(Math.max(0, reflectVec.z), Math.round(15 * metallicFinish));

        // Compute color shades
        const hexToRgb = (hex: string) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
          } : { r: 99, g: 102, b: 241 };
        };

        const baseRgb = hexToRgb(lightColor);

        // Mix metal shade, specular spotlight glow, and ambient shadow
        const rColor = Math.min(255, Math.round((baseRgb.r * 0.45 + baseRgb.r * 0.35 * diffuseIntensity * lightIntensity + 255 * 0.55 * specularIntensity)));
        const gColor = Math.min(255, Math.round((baseRgb.g * 0.45 + baseRgb.g * 0.35 * diffuseIntensity * lightIntensity + 255 * 0.55 * specularIntensity)));
        const bColor = Math.min(255, Math.round((baseRgb.b * 0.45 + baseRgb.b * 0.35 * diffuseIntensity * lightIntensity + 255 * 0.55 * specularIntensity)));

        // Path drawing
        ctx.beginPath();
        ctx.moveTo(originX + v[0].x, originY + v[0].y);
        for (let i = 1; i < v.length; i++) {
          ctx.lineTo(originX + v[i].x, originY + v[i].y);
        }
        ctx.closePath();

        // Fill color with rigid edge highlighting gradients to look stunning
        ctx.fillStyle = `rgb(${rColor}, ${gColor}, ${bColor})`;
        ctx.fill();

        // Edge glowing highlight drawing
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = `rgba(${baseRgb.r + 50}, ${baseRgb.g + 50}, ${baseRgb.b + 50}, 0.6)`;
        ctx.stroke();
      });

      animFrameId.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, [shape, rotationSpeed, pulseFreq, lightIntensity, lightColor, metallicFinish, showGrid, isAnimating]);

  // Handle Code Copy actions
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(isRtl ? 'تم نسخ برمجية التشغيل الرسومية إلى الحافظة' : 'Production code copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  // ----------------------------------------------------
  // FULL ROBUST REACT NATIVE (R3F) SOURCE CODE
  // ----------------------------------------------------
  const reactNativeR3fCode = `import React, { useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, StatusBar } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { SafeAreaView } from 'react-native-safe-area-context';

/* 
 * 3D Metallic Corporate Logo Component with Continuous 360 Rotation
 * and Responsive Breathing Pulse Animation.
 */
function Geometric3DLogo() {
  const meshRef = useRef(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    
    // Smooth continuous 360-degree rotation (pitch and yaw)
    const time = state.clock.getElapsedTime();
    meshRef.current.rotation.y = time * ${rotationSpeed};
    meshRef.current.rotation.x = time * ${rotationSpeed * 0.45};
    
    // Subtle breathing pulse scaling animation
    const scale = 1.0 + Math.sin(time * ${pulseFreq * 2}) * 0.045;
    meshRef.current.scale.set(scale, scale, scale);
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {/* Sharp, rigid geometric shape structure */}
      ${shape === 'octahedron' 
        ? '<octahedronGeometry args={[2.2, 0]} />' 
        : shape === 'prism'
        ? '<cylinderGeometry args={[1.8, 1.8, 3.2, 3]} />'
        : shape === 'cube'
        ? '<boxGeometry args={[2, 2, 2]} />'
        : '<dodecahedronGeometry args={[2, 0]} />'
      }
      <meshStandardMaterial
        color="${lightColor}"
        roughness={${(1 - metallicFinish).toFixed(2)}}
        metalness={${metallicFinish.toFixed(2)}}
        flatShading={true}
        emissive="${lightColor}"
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}

/* 
 * High-tech Industry Coordinate Grid Floor Section
 */
function CoordinateGridFloor() {
  return (
    <gridHelper 
      args={[35, 30, '${lightColor}', 'rgba(99, 102, 241, 0.12)']} 
      position={[0, -3.8, 0]} 
    />
  );
}

export default function WelcomeSplashScreen() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      
      {/* Dedicated canvas container for full-range 3D rendering */}
      <View style={styles.canvasContainer}>
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
          {/* Studio Dynamic Spotlights and ambient lighting */}
          <ambientLight intensity={0.25} />
          <directionalLight 
            position={[5, 8, 5]} 
            intensity={${lightIntensity}} 
            color="${lightColor}" 
            castShadow 
          />
          <pointLight position={[-6, -4, -6]} intensity={0.4} />
          
          <Geometric3DLogo />
          {${showGrid} ? <CoordinateGridFloor /> : null}
        </Canvas>
      </View>

      {/* Strict Legal Footer over UI */}
      <SafeAreaView style={styles.footerWrapper}>
        <Text style={styles.legalText}>
          By accessing this application, you agree to our Terms of Service & EULA and Privacy Policy. All Rights Reserved © 2026.
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Clean slate backdrop
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerWrapper: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalText: {
    fontSize: 11,
    color: '#64748b', // Muted slate gray
    textAlign: 'center',
    lineHeight: 16,
    fontFamily: 'System',
    letterSpacing: 0.25,
  },
});`;

  // ----------------------------------------------------
  // FULL ROBUST FLUTTER SOURCE CODE
  // ----------------------------------------------------
  const flutterCode = `import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_cube/flutter_cube.dart';

/* 
 * High-End 3D Welcome (Splash) Screen for Mobile Application.
 * Powered by Flutter with rigid mesh lighting and continuous animation.
 */
class WelcomeSplashScreen extends StatefulWidget {
  const WelcomeSplashScreen({Key? key}) : super(key: key);

  @override
  _WelcomeSplashScreenState createState() => _WelcomeSplashScreenState();
}

class _WelcomeSplashScreenState extends State<WelcomeSplashScreen> 
    with SingleTickerProviderStateMixin {
  
  late AnimationController _animationController;
  late Scene _scene;
  Object? _cubeLogo;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 5000),
    )..repeat(); // Keep the coordinate loop repeating continuously
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  void _onSceneCreated(Scene scene) {
    _scene = scene;
    
    // Add professional studio spotlights and ambient lighting
    scene.light.position.setFrom(Vector3(5.0, 8.0, 7.0));
    scene.light.setColor(Colors.white, 0.4, ${lightIntensity}, 0.1);
    
    // Render high-fidelity metallic corporate geometric shape
    _cubeLogo = Object(
      name: '${shape}',
      backfaceCulling: true,
      fileName: 'assets/models/corporate_logo.obj', // custom metallic OBJ model
      scale: Vector3(10.0, 10.0, 10.0),
    );
    
    scene.world.add(_cubeLogo!);
    
    // Hook up animation tick listeners
    _animationController.addListener(() {
      if (_cubeLogo != null) {
        // Continuous 360-degree rotation (Y-axis speed parameter)
        double angle = _animationController.value * 2 * math.pi;
        _cubeLogo!.rotation.y = angle * ${rotationSpeed};
        _cubeLogo!.rotation.x = angle * ${rotationSpeed * 0.4};
        
        // Subtle breathing scaling pulse
        double pulse = 1.0 + math.sin(_animationController.value * 4 * math.pi) * 0.045;
        _cubeLogo!.scale.setFrom(Vector3(10.0 * pulse, 10.0 * pulse, 10.0 * pulse));
        
        _scene.update();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final Size size = MediaQuery.of(context).size;
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A), // Dark Slate backdrop
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Background Tech Grid projection layer (simulated floor)
          if (${showGrid})
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              height: size.height * 0.28,
              child: CustomPaint(
                painter: CoordinateGridPainter(
                  gridColor: const Color(0x226366F1), // Translucent indigo
                ),
              ),
            ),
            
          // Central 3D Interactive Logo Canvas
          Center(
            child: SizedBox(
              width: size.width * 0.85,
              height: size.height * 0.6,
              child: Cube(
                onSceneCreated: _onSceneCreated,
              ),
            ),
          ),

          // Strict Regulatory Legal Footer
          Positioned(
            bottom: 24,
            left: 20,
            right: 20,
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                   GestureDetector(
                     onTap: () {
                       // Direct secure legal link navigation
                     },
                     child: const Text(
                       "By accessing this application, you agree to our Terms of Service & EULA and Privacy Policy. All Rights Reserved © 2026.",
                       style: TextStyle(
                         fontSize: 11,
                         color: Color(0xFF64748B), // Strict muted 11px gray
                         fontWeight: FontWeight.w400,
                         height: 1.45,
                         letterSpacing: 0.2,
                       ),
                       textAlign: TextAlign.center,
                     ),
                   ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class CoordinateGridPainter extends CustomPainter {
  final Color gridColor;
  CoordinateGridPainter({required this.gridColor});

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = gridColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final double width = size.width;
    final double height = size.height;
    
    // Draw horizontal lines projecting forward
    const int lines = 6;
    for (int i = 0; i < lines; i++) {
      double ratio = i / (lines - 1);
      double y = ratio * height;
      paint.strokeWidth = 1.0 + ratio * 1.5;
      canvas.drawLine(Offset(0, y), Offset(width, y), paint);
    }

    // Perspective converging rays
    const int rays = 18;
    for (int i = 0; i <= rays; i++) {
      double fromX = (i / rays) * width;
      double toX = width / 2 + (i / rays - 0.5) * width * 3.5;
      canvas.drawLine(Offset(fromX, 0), Offset(toX, height), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}`;

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Upper Descriptive Jumbotron Card */}
      <div className="relative bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-[2.5rem] p-6 sm:p-8 md:p-10 shadow-2xl overflow-hidden border border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.18),transparent_50%)] pointer-events-none" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-1.5 bg-indigo-500/15 border border-indigo-500/30 px-3 py-1 rounded-full text-xs text-indigo-300 font-bold active:scale-95 transition-all">
              <Sparkles size={13} className="animate-spin text-cyan-400" />
              <span>{isRtl ? 'تصميم الهوية الاحترافية ثلاثية الأبعاد' : 'MOBILE UI SYSTEM DESIGNER'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight">
              {isRtl ? 'واجهة الترحيب التفاعلية ثلاثية الأبعاد (Splash Screen)' : 'Premium 3D Welcome (Splash) Screen'}
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-medium">
              {isRtl 
                ? 'مستلهمة من الهوية الرقمية الصلبة والحواف المعدنية الصارمة. تحكم في الإضاءة الفنية، أنماط الدوران، ومظهر الشعار مع معاينة حية سريعة وتصدير فوري للأكواد البرمجية.'
                : 'Customizable corporate metallic logo rendering with continuous 360-degree rotation, elegant lighting controls, a perspective coordinate grid floor, and a regulatory footer compliant with license mandates.'}
            </p>
          </div>
          
          <div className="flex-shrink-0 flex gap-3 h-fit items-center">
            <div className="hidden sm:flex-col items-end text-right font-mono text-xs text-indigo-300 bg-white/5 border border-white/10 p-3 rounded-2xl">
              <span className="text-slate-400 text-[9px] font-bold uppercase tracking-wider">FRAMEWORK SPEC</span>
              <span className="font-semibold text-white mt-1">Capacitor & Native</span>
              <span className="text-[10px] text-cyan-400">OpenGLES 3.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Designer Grid Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left column: Live Responsive Smartphone Simulator Preview Frame */}
        <div className="lg:col-span-12 xl:col-span-5 flex justify-center">
          <div className="relative w-full max-w-[340px] aspect-[9/18.5] bg-black rounded-[3rem] p-3 shadow-2xl border-4 border-slate-800 ring-12 ring-slate-900/30">
            {/* Top Ear Piece Speaker Line */}
            <div className="absolute top-5 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-full z-30 flex items-center justify-center">
              <div className="w-8 h-1 bg-slate-800 rounded-full" />
            </div>

            {/* Simulated Live Welcome Splash Container */}
            <div className="relative w-full h-full bg-slate-900 rounded-[2.5rem] overflow-hidden flex flex-col justify-between p-6">
              
              {/* Top ambient tech coordinates display */}
              <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono tracking-widest uppercase mt-4 select-none">
                <span>SYSTEM INIT OK</span>
                <span className="animate-pulse">● LATENCY: 12ms</span>
              </div>

              {/* Central canvas for the mathematically projected metal rendering */}
              <div className="flex-1 flex items-center justify-center relative">
                <canvas 
                  ref={canvasRef}
                  width={310}
                  height={380}
                  className="w-full h-full max-h-[380px] rounded-2xl shadow-inner pointer-events-none"
                />

                {/* Overlaid neon spotlight glares */}
                <div 
                  className="absolute top-[30%] left-[30%] w-16 h-16 rounded-full blur-2xl opacity-45 pointer-events-none mix-blend-screen"
                  style={{ backgroundColor: lightColor }}
                />
              </div>

              {/* Strict regulatory legal footer (Exactly matches the instructions) */}
              <div className="mb-2 shrink-0">
                <p className="text-[11px] text-slate-500/80 leading-relaxed text-center font-normal tracking-wide px-1.5 select-text">
                  By accessing this application, you agree to our Terms of Service & EULA and Privacy Policy. All Rights Reserved © 2026.
                </p>
              </div>
            </div>
            
            {/* Elegant home bottom physical gesture indicator strip */}
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-28 h-1 bg-slate-700/80 rounded-full z-20" />
          </div>
        </div>

        {/* Right column: Multi-Tab control dashboard and Code hub */}
        <div className="lg:col-span-12 xl:col-span-7 space-y-6">
          
          {/* Quick presets row */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-gray-150 dark:border-slate-800 shadow-md">
            <h3 className="text-sm font-black text-slate-900 dark:text-white mb-3 uppercase tracking-wider flex items-center gap-2">
              <Bookmark size={15} className="text-indigo-600" />
              <span>{isRtl ? 'السمات والمظاهر الجاهزة للمنصة' : 'Predefined Metallic Themes'}</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {presets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="p-3 bg-gray-50 hover:bg-indigo-50/50 dark:bg-slate-950/30 dark:hover:bg-slate-950/70 border border-gray-200 dark:border-slate-800 rounded-2xl text-left text-xs transition-all active:scale-95 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.color }} />
                    <span className="text-slate-400 capitalize font-mono text-[9px]">{preset.shape}</span>
                  </div>
                  <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Canvas control customization panel */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-gray-150 dark:border-slate-800 shadow-md space-y-6">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3.5">
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders size={15} className="text-indigo-600" />
                <span>{isRtl ? 'لوحة المعايرة الهندسية والإضاءة' : '3D Lighting & Geometry Calibration'}</span>
              </h3>
              
              {/* Play / pause controls */}
              <button
                type="button"
                onClick={() => setIsAnimating(!isAnimating)}
                className={`p-2 rounded-xl flex items-center gap-1.5 text-xs font-bold transition-all ${
                  isAnimating 
                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400' 
                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                } cursor-pointer`}
              >
                {isAnimating ? <Pause size={13} /> : <Play size={13} />}
                <span>{isAnimating ? (isRtl ? 'إيقاف الحركة' : 'Pause Render') : (isRtl ? 'تشغيل الحركة' : 'Play Render')}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Column 1: Shape & Speed */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-2">
                    {isRtl ? 'الشكل الهندسي للشعار' : 'Corporate geometric mesh shape'}
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['octahedron', 'prism', 'cube', 'dodecahedron'] as ShapeType[]).map((sh) => (
                      <button
                        key={sh}
                        type="button"
                        onClick={() => setShape(sh)}
                        className={`py-2 px-1 border rounded-xl font-mono text-[10px] font-bold text-center transition-all capitalize cursor-pointer ${
                          shape === sh 
                            ? 'bg-indigo-600 text-white border-indigo-650' 
                            : 'bg-gray-50 text-slate-600 border-gray-200 dark:bg-slate-950/20 dark:border-slate-800 dark:text-slate-400 hover:bg-gray-100'
                        }`}
                      >
                        {sh}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                    <span>{isRtl ? 'سرعة الدوران المستمر' : 'Continuous rotation speed'}</span>
                    <span className="font-mono text-indigo-600">{rotationSpeed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={rotationSpeed}
                    onChange={(e) => setRotationSpeed(parseFloat(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                    <span>{isRtl ? 'تردد نبض التنفس الهادئ' : 'Breathing pulse frequency'}</span>
                    <span className="font-mono text-indigo-600">{pulseFreq.toFixed(1)}Hz</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={pulseFreq}
                    onChange={(e) => setPulseFreq(parseFloat(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
              </div>

              {/* Column 2: Lights & Grid */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-2">
                    {isRtl ? 'لون تسليط الإضاءة' : 'Dynamic spotlight shader color'}
                  </label>
                  <div className="flex gap-2.5">
                    {['#6336f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#f43f5e'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setLightColor(color)}
                        className={`w-7 h-7 rounded-lg border-2 transition-all active:scale-90 cursor-pointer ${
                          lightColor === color ? 'border-indigo-600 ring-2 ring-indigo-300' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                    <span>{isRtl ? 'شدة الإضاءة الفنية' : 'Studio spotlight intensity'}</span>
                    <span className="font-mono text-indigo-600">{lightIntensity.toFixed(1)}lm</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.0"
                    step="0.1"
                    value={lightIntensity}
                    onChange={(e) => setLightIntensity(parseFloat(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>

                {/* Toggle Grid */}
                <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-slate-800">
                  <div>
                    <span className="text-xs font-bold block text-slate-800 dark:text-slate-200">
                      {isRtl ? 'أرضية الشبكة المنظورية' : 'Coordinate perspective floor grid'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {isRtl ? 'يرسم شبكة خطية إشعاعية متلاشية' : 'Draws dynamic vanishing grid lines'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGrid(!showGrid)}
                    className={`w-12 h-6.5 rounded-full p-1 transition-colors duration-200 focus:outline-none cursor-pointer ${
                      showGrid ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-800'
                    }`}
                  >
                    <div className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform duration-200 ${
                      showGrid ? 'translate-x-[22px]' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Production Code Exporter System */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4">
              <div>
                <span className="text-[9px] text-indigo-400 font-extrabold uppercase tracking-widest leading-none block">NATIVE EXPORT HUB</span>
                <h3 className="text-base font-bold text-white mt-1">
                  {isRtl ? 'أكواد برمجية جاهزة للإنتاج والتشغيل المباشر' : 'Get Production-Ready Mobile Native Code'}
                </h3>
              </div>

              {/* Framework switcher tabs */}
              <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800/80">
                <button
                  type="button"
                  onClick={() => { setSelectedSdk('rn'); toast.info('Selected React Native export format'); }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    selectedSdk === 'rn' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Cpu size={12} />
                  <span>React Native (R3F)</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedSdk('flutter'); toast.info('Selected Flutter export format'); }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    selectedSdk === 'flutter' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Smartphone size={12} />
                  <span>Flutter Dart code</span>
                </button>
              </div>
            </div>

            {/* Structured responsive code output frame with copying */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800">
              <div className="flex justify-between items-center px-4 py-3 bg-slate-900/60 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-slate-500 font-mono ml-2">
                    {selectedSdk === 'rn' ? 'WelcomeSplashScreen.tsx (React Native)' : 'welcome_splash_screen.dart (Flutter)'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedSdk === 'rn' ? reactNativeR3fCode : flutterCode)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-indigo-650 hover:text-white text-slate-300 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copied ? (isRtl ? 'تم النسخ!' : 'Copied!') : (isRtl ? 'نسخ الكود' : 'Copy Code')}</span>
                </button>
              </div>

              {/* Readable syntax highlight-like styled container */}
              <div className="p-4 overflow-x-auto max-h-[350px] font-mono text-xs text-slate-300 leading-relaxed style-scrollbar scroll-smooth">
                <pre>{selectedSdk === 'rn' ? reactNativeR3fCode : flutterCode}</pre>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
