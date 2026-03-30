import type { GenerationParams, GenerationProgress } from '../types';

const PRESETS: Record<string, string> = {
  bedroom: 'A realistic master bedroom with a queen bed, nightstands, rug, and soft lighting, 4k, interior design',
  living_room: 'A modern living room with a comfortable sofa, coffee table, rug, and natural light, 4k, interior design',
  kitchen: 'A modern kitchen with white shaker cabinets, marble island, stainless steel appliances, and subway tile backsplash, 4k, interior design',
  bathroom: 'A luxury bathroom with a freestanding tub, glass shower, marble vanity, and gold fixtures, 4k, interior design',
  office: 'A productive home office with a large wooden desk, ergonomic chair, bookshelves, and plants, 4k, interior design',
};

interface PromptPanelProps {
  params: GenerationParams;
  onChange: (p: Partial<GenerationParams>) => void;
  onGenerate: () => void;
  status: string;
  progress: GenerationProgress | null;
}

export function PromptPanel({ params, onChange, onGenerate, status, progress }: PromptPanelProps) {
  return (
    <section className="bg-[#151822] border border-[#232632] rounded-2xl p-4 shadow-lg">
      <h2 className="text-lg font-semibold mt-0 mb-3">2) Describe your change</h2>

      <select
        value=""
        onChange={e => { if (PRESETS[e.target.value]) onChange({ prompt: PRESETS[e.target.value] }); }}
        className="w-full bg-[#0f121a] border border-[#2a2f3a] rounded-lg text-gray-200 px-2 py-2 mb-3"
      >
        <option value="">-- Quick Prompt Presets --</option>
        <option value="bedroom">Bedroom</option>
        <option value="living_room">Living Room</option>
        <option value="kitchen">Kitchen</option>
        <option value="bathroom">Bathroom</option>
        <option value="office">Home Office</option>
      </select>

      <textarea
        rows={6}
        value={params.prompt}
        onChange={e => onChange({ prompt: e.target.value })}
        placeholder="e.g., Replace dark cabinets with white shaker cabinets; add a marble island with brass pendant lights; realistic lighting"
        className="w-full bg-[#0f121a] border border-[#2a2f3a] rounded-lg text-gray-200 px-2 py-2 mb-3 resize-y"
      />

      <label className="block text-sm text-gray-300 mb-3">
        Negative prompt
        <input
          type="text"
          value={params.negativePrompt}
          onChange={e => onChange({ negativePrompt: e.target.value })}
          className="w-full mt-1 bg-[#0f121a] border border-[#2a2f3a] rounded-lg text-gray-200 px-2 py-1.5"
        />
      </label>

      <div className="grid grid-cols-4 gap-2.5 mb-4">
        {([
          { label: 'Steps', key: 'steps', type: 'number', min: 10, max: 80, step: 1 },
          { label: 'Guidance', key: 'guidance', type: 'number', min: 1, max: 15, step: 0.1 },
          { label: 'Strength', key: 'strength', type: 'number', min: 0.1, max: 1.0, step: 0.05 },
          { label: 'Seed', key: 'seed', type: 'number', min: undefined, max: undefined, step: 1 },
        ] as const).map(({ label, key, type, min, max, step }) => (
          <label key={key} className="text-sm text-gray-300">
            {label}
            <input
              type={type}
              value={params[key]}
              min={min}
              max={max}
              step={step}
              placeholder={key === 'seed' ? '(optional)' : undefined}
              onChange={e => onChange({ [key]: e.target.value })}
              className="w-full mt-1 bg-[#0f121a] border border-[#2a2f3a] rounded-lg text-gray-200 px-2 py-1.5"
            />
          </label>
        ))}
      </div>

      <button
        onClick={onGenerate}
        disabled={!!progress}
        className="w-full bg-[#5865f2] border border-[#5865f2] text-white font-semibold text-base py-3 rounded-xl cursor-pointer hover:brightness-110 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {progress ? 'Generating...' : 'Generate'}
      </button>

      {/* Progress bar */}
      {progress && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Step {progress.step} / {progress.total}</span>
            <span>{Math.round((progress.step / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 bg-[#2a2f3a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#5865f2] rounded-full transition-all duration-200"
              style={{ width: `${(progress.step / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {status && !progress && (
        <p className="mt-3 text-sm text-gray-400">{status}</p>
      )}
    </section>
  );
}
