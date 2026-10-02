import React, { useEffect, useRef, useState } from 'react';
import { Camera, VideoOff, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { sounds } from '../../lib/sounds';

interface Props {
  onScan: (barcode: string) => void;
  isRtl: boolean;
  onClose?: () => void;
}

export default function BarcodeScannerScanner({ onScan, isRtl, onClose }: Props) {
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successCode, setSuccessCode] = useState<string | null>(null);

  const containerId = 'camera-barcode-sensor';
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // 1. Fetch available cameras on mount
  useEffect(() => {
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back-facing camera if possible
          const backCam = devices.find(d => 
            d.label.toLowerCase().includes('back') || 
            d.label.toLowerCase().includes('rear') || 
            d.label.toLowerCase().includes('environment')
          );
          setSelectedCameraId(backCam ? backCam.id : devices[0].id);
        } else {
          setErrorMsg(isRtl ? 'لا يوجد كاميرات متاحة في هذا الجهاز.' : 'No cameras found on this device.');
        }
      })
      .catch((err) => {
        console.warn('[BarcodeScanner] Error fetching cameras:', err);
        setErrorMsg(isRtl 
          ? 'يرجى تفعيل صلاحية الوصول للكاميرا للبدء بالمسح الضوئي.' 
          : 'Please grant camera access permissions to begin scanning.');
      });

    return () => {
      stopScanner();
    };
  }, [isRtl]);

  // 2. Start Scanner function
  const startScanner = async (cameraId: string) => {
    if (!cameraId) return;
    setErrorMsg(null);
    setSuccessCode(null);

    // Stop previous scanner if any
    await stopScanner();

    try {
      const html5Qrcode = new Html5Qrcode(containerId);
      scannerRef.current = html5Qrcode;

      await html5Qrcode.start(
        cameraId,
        {
          fps: 15,
          qrbox: (width, height) => {
            // Horizontal rectangular target region optimized for traditional 1D barcodes
            const boxWidth = Math.min(width * 0.85, 420);
            const boxHeight = Math.min(height * 0.45, 180);
            return { width: boxWidth, height: boxHeight };
          },
          aspectRatio: 1.7777778, // Wide ratio
        },
        (decodedText) => {
          // Success callback
          const sanitized = decodedText.trim();
          if (sanitized) {
            sounds.playSuccess();
            setSuccessCode(sanitized);
            onScan(sanitized);
            
            // Highlight success momentarily then stop
            setTimeout(() => {
              stopScanner();
              if (onClose) onClose();
            }, 800);
          }
        },
        (errorMessage) => {
          // Noise callback (handled silently by html5-qrcode)
        }
      );

      setIsScanning(true);
    } catch (err: any) {
      console.warn('[BarcodeScanner] Start failed gracefully:', err);
      setErrorMsg(isRtl 
        ? `فشل فتح تدفق الفيديو: الكاميرا قيد الاستخدام أو الصلاحية مرفوضة.` 
        : `Failed to open video stream: Camera in use or permission denied.`);
      setIsScanning(false);
    }
  };

  // 3. Stop Scanner function
  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (e) {
        console.warn('[BarcodeScanner] Error during stop:', e);
      } finally {
        scannerRef.current = null;
        setIsScanning(false);
      }
    }
  };

  // 4. Handle camera switch
  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCameraId(id);
    if (isScanning) {
      startScanner(id);
    }
  };

  // 5. Toggle trigger manual buttons
  const handleToggleScan = () => {
    sounds.playClick();
    if (isScanning) {
      stopScanner();
    } else {
      startScanner(selectedCameraId);
    }
  };

  return (
    <div className="bg-slate-950 dark:bg-black p-4 rounded-2xl border border-slate-800 space-y-4 shadow-2xl relative overflow-hidden">
      {/* Decorative pulse glow */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500" />

      {/* Top controls section */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className={`h-5 w-5 ${isScanning ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
          <span className="text-xs font-black tracking-wide uppercase">
            {isRtl ? 'الماسح الضوئي الذكي' : 'Camera Intelligence Scannner'}
          </span>
        </div>

        {cameras.length > 1 && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <select
              value={selectedCameraId}
              onChange={handleCameraChange}
              className="w-full sm:w-48 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-[10px] sm:text-xs font-bold text-slate-300 outline-none focus:border-emerald-500 transition-colors"
            >
              {cameras.map((cam, idx) => (
                <option key={cam.id} value={cam.id} className="bg-slate-950">
                  {cam.label || `${isRtl ? 'كاميرا' : 'Camera'} ${idx + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Camera Live Region / Screen */}
      <div className="relative aspect-video w-full max-w-lg mx-auto bg-slate-900/40 rounded-xl overflow-hidden border border-slate-800 flex flex-col items-center justify-center min-h-[180px]">
        {/* HTML5 QR Code Mount Div */}
        <div id={containerId} className="absolute inset-0 w-full h-full object-cover [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />

        {/* Custom HUD Scanner Styling Layer */}
        {isScanning && !successCode && (
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
            <div className="flex justify-between w-full">
              <div className="border-t-3 border-l-3 border-emerald-400 w-6 h-6 rounded-tl-lg" />
              <div className="border-t-3 border-r-3 border-emerald-400 w-6 h-6 rounded-tr-lg" />
            </div>

            {/* Glowing Laser line animation moving vertically */}
            <div className="w-[90%] mx-auto h-[2.5px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-lg shadow-emerald-400/50 animate-bounce" />

            <div className="flex justify-between w-full">
              <div className="border-b-3 border-l-3 border-emerald-400 w-6 h-6 rounded-bl-lg" />
              <div className="border-b-3 border-r-3 border-emerald-400 w-6 h-6 rounded-br-lg" />
            </div>
          </div>
        )}

        {/* Success overlay */}
        {successCode && (
          <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-xs flex flex-col items-center justify-center text-center p-4">
            <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-xl animate-scale-up mb-2">
              <Check className="h-6 w-6 stroke-[3.5]" />
            </div>
            <p className="text-white font-black text-xs sm:text-sm tracking-wide">
              {isRtl ? 'تم التقاط الباركود بنجاح!' : 'Barcode Decoded!'}
            </p>
            <p className="text-emerald-300 font-mono text-sm font-bold mt-1.5 bg-black/40 px-3.5 py-1 rounded-full border border-emerald-500/20 shadow-xs">
              {successCode}
            </p>
          </div>
        )}

        {/* Idle/Non-scanning message */}
        {!isScanning && !successCode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4 select-none z-10 bg-slate-950/70">
            <VideoOff size={32} className="text-slate-500" />
            <div>
              <p className="text-slate-350 font-bold text-xs">
                {isRtl ? 'الكاميرا متوقفة حالياً' : 'Camera feed is sleeping'}
              </p>
              <p className="text-slate-500 text-[10px] max-w-[280px] mx-auto mt-1 leading-normal font-semibold">
                {isRtl 
                  ? 'اضغط على زر التفعيل لتشغيل عدسة الكاميرا ووضع المنتج أمامها للمسح والتقاط الرمز تلقائياً'
                  : 'Click activate below to scan physical barcode or QR sticker directly from your camera stream.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Actions section */}
      <div className="flex justify-between items-center gap-2 pt-1 border-t border-slate-900">
        {errorMsg ? (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-500 bg-amber-500/5 px-3 py-1.5 rounded-xl border border-amber-500/10 max-w-[70%]">
            <AlertCircle size={12} className="shrink-0" />
            <span className="font-semibold leading-tight line-clamp-1">{errorMsg}</span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-500 font-medium leading-relaxed">
            {isRtl 
              ? 'الماسح يدعم الباركود العادي 1D وأكواد الـ QR.' 
              : 'Supports standard EAN/UPC barcodes & QR codes.'}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleScan}
            className={`px-4 py-2 text-xs font-black rounded-lg cursor-pointer transition-all active:scale-[0.97] flex items-center gap-1.5
              ${isScanning 
                ? 'bg-slate-800 text-white hover:bg-slate-700' 
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/15'}`}
          >
            <RefreshCw size={13} className={isScanning ? 'animate-spin' : ''} />
            <span>{isScanning ? (isRtl ? 'إيقاف الكاميرا' : 'Stop Camera') : (isRtl ? 'تفعيل الكاميرا' : 'Start Scan')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
