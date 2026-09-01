import React, { useState, useEffect, useRef } from 'react';

interface RenameModalProps {
  isOpen: boolean;
  initialValue: string;
  title: string;
  onSave: (newName: string) => void;
  onCancel: () => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({ isOpen, initialValue, title, onSave, onCancel }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue);
    if (isOpen) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      
      // Forces Electron to clear its confused focus state
      if (inputRef.current) inputRef.current.blur();
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 100);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[9999] flex items-center justify-center"
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onClick={onCancel}
    >
      <div 
        className="bg-[#1a1a1a] border-2 border-[var(--accent-color)] p-5 rounded-lg flex flex-col gap-4 shadow-[4px_4px_0px_var(--accent-glow)] min-w-[300px]"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="font-fantasy text-[var(--accent-color)] text-xl tracking-wide">{title}</label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(value);
            if (e.key === 'Escape') onCancel();
          }}
          className="bg-black border border-[var(--accent-color)] text-white px-2.5 py-2 rounded font-sans outline-none w-full"
        />
        <div className="flex justify-end gap-2.5 mt-2">
          <button 
            onClick={onCancel}
            className="bg-transparent border border-[var(--accent-color)] text-[var(--accent-color)] px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(value)}
            className="bg-[var(--accent-color)] text-black border-none px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
