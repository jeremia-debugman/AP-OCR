import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, ExternalLink, FileText, Download } from 'lucide-react';

interface DocumentViewerProps {
  fileUrl?: string | null;
  fileName: string;
  fileType: string;
  pageCount?: number;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileUrl,
  fileName,
  fileType,
  pageCount = 1,
}) => {
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const isPdf = fileType.toLowerCase().includes('pdf') || fileName.toLowerCase().endsWith('.pdf');

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 250));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 50));
  const handleResetZoom = () => {
    setZoom(100);
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div
      className={`flex flex-col bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all ${
        isFullscreen ? 'fixed inset-4 z-50 bg-slate-100' : 'h-full min-h-[550px]'
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-900 truncate max-w-[200px]" title={fileName}>
            {fileName}
          </span>
          {pageCount > 1 && (
            <span className="text-[10px] font-bold bg-white text-slate-600 px-2 py-0.5 rounded border border-slate-200">
              {pageCount} Pages
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded transition"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-[11px] font-mono hover:bg-slate-200 text-slate-600 hover:text-slate-850 rounded transition"
            title="Reset Zoom"
          >
            {zoom}%
          </button>
          <button
            onClick={handleZoomIn}
            className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded transition"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button
            onClick={handleRotate}
            className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded transition"
            title="Rotate Clockwise"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-850 rounded transition"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded transition"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen View'}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewer Canvas */}
      <div className="flex-1 relative overflow-auto p-4 flex items-center justify-center bg-slate-200 select-none">
        {fileUrl ? (
          isPdf ? (
            <div className="w-full h-full min-h-[480px] flex items-center justify-center">
              <iframe
                src={`${fileUrl}#toolbar=0&navpanes=0`}
                title={fileName}
                className="w-full h-full min-h-[480px] rounded border border-slate-350 bg-white shadow-md transition-transform"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}
              />
            </div>
          ) : (
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <img
                src={fileUrl}
                alt={fileName}
                className="max-w-full max-h-[75vh] object-contain rounded border border-slate-350 shadow-md transition-transform duration-100"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}
              />
            </div>
          )
        ) : (
          <div className="text-center text-slate-400 flex flex-col items-center gap-2">
            <FileText className="w-10 h-10 stroke-[1.5] text-slate-400" />
            <p className="text-xs">No document preview available</p>
          </div>
        )}
      </div>

      {/* Bottom status strip */}
      <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
        <div>Format: <span className="text-slate-700 uppercase font-mono">{fileType}</span></div>
        <div className="flex items-center gap-3">
          <span>{pageCount} page(s)</span>
          {fileUrl && (
            <a
              href={fileUrl}
              download={fileName}
              className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> Download original
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
