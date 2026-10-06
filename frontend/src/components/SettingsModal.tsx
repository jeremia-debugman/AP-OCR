import React, { useState, useEffect } from 'react';
import { AIConfig } from '../types';
import { api } from '../services/api';
import { X, Sparkles, Key, Cpu, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: (config: AIConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onConfigSaved }) => {
  const [provider, setProvider] = useState<AIConfig['provider']>('gemini');
  const [apiKey, setApiKey] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [currentConfig, setCurrentConfig] = useState<AIConfig | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      setIsLoading(true);
      const conf = await api.getConfig();
      setCurrentConfig(conf);
      setProvider(conf.provider);
      setModelName(conf.model_name || getDefaultModel(conf.provider));
    } catch (err) {
      console.error('Failed to load AI config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getDefaultModel = (prov: string) => {
    switch (prov) {
      case 'gemini':
        return 'gemini/gemini-1.5-flash';
      case 'anthropic':
        return 'anthropic/claude-3-5-sonnet-20241022';
      case 'openai':
        return 'gpt-4o';
      case 'qwen':
        return 'dashscope/qwen-vl-plus';
      case 'azure':
        return 'azure/gpt-4o';
      default:
        return 'local_heuristic_engine';
    }
  };

  const handleProviderChange = (newProv: AIConfig['provider']) => {
    setProvider(newProv);
    setModelName(getDefaultModel(newProv));
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      const updated = await api.updateConfig({
        provider,
        api_key: apiKey.trim() ? apiKey.trim() : undefined,
        model_name: modelName.trim() ? modelName.trim() : undefined,
      });
      setCurrentConfig(updated);
      setIsSaved(true);
      onConfigSaved(updated);
      setTimeout(() => {
        setIsSaved(false);
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">AI OCR Extraction Engine</h2>
              <p className="text-[11px] text-slate-500">Configure Document Vision AI & OCR Models</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Provider Selection */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Vision AI Provider
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'gemini', label: 'Google Gemini', desc: 'Fast, High Accuracy' },
                { id: 'anthropic', label: 'Anthropic Claude', desc: 'Claude 3.5 Sonnet' },
                { id: 'openai', label: 'OpenAI GPT-4o', desc: 'Omni Vision' },
                { id: 'qwen', label: 'Alibaba Qwen', desc: 'Qwen-VL Plus' },
                { id: 'azure', label: 'Azure OpenAI', desc: 'Enterprise Vision' },
                { id: 'local_fallback', label: 'Local Engine', desc: 'Native PyMuPDF' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id as any)}
                  className={`p-3 rounded-lg border text-left transition ${
                    provider === p.id
                      ? 'border-blue-600 bg-blue-50 text-blue-800 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-450 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-xs">{p.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Field */}
          {provider !== 'local_fallback' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-slate-400" />
                  API Key
                </label>
                {currentConfig?.is_configured && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/50">
                    Configured ({currentConfig.api_key})
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={currentConfig?.is_configured ? 'Leave blank to keep existing key' : `Enter ${provider.toUpperCase()} API Key`}
                  className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded-lg px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none font-mono transition"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1.5 text-xs font-semibold text-slate-400 hover:text-slate-700"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                {provider === 'gemini' && 'Provide your Google Gemini API Key for direct high-speed document extraction.'}
                {provider === 'anthropic' && 'Provide Anthropic API Key for Claude 3.5 Sonnet Vision processing.'}
                {provider === 'openai' && 'Provide OpenAI API Key for GPT-4o document processing.'}
              </p>
            </div>
          )}

          {/* Model Name */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
              Model Identifier
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. gemini/gemini-1.5-flash"
              className="w-full bg-white border border-slate-200 focus:border-blue-650 focus:ring-1 focus:ring-blue-600 rounded-lg px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none font-mono transition"
            />
          </div>

          {/* Offline/Fallback info */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold text-slate-800">Zero-Config Offline Support:</span> If no API key is provided, the engine seamlessly uses native PyMuPDF document layer parsing and pattern heuristics so all extraction and Excel workflows run with 100% availability.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 bg-white border border-slate-300 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Saving...
              </>
            ) : isSaved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Saved!
              </>
            ) : (
              'Save & Apply Settings'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
