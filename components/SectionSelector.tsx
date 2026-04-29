// @ts-nocheck
import React, { useState } from 'react';

// Predefined sections from the SRS document
const PREDEFINED_SECTIONS = [
  'Abstract',
  'Introduction',
  'Objectives',
  'Literature Review',
  'Methodology',
  'Project Timeline',
  'Budget Justification',
  'Team Expertise',
  'Expected Outcomes',
  'Societal Impact',
  'Sustainability',
  'Risk & Mitigation',
  'IP & Commercialization Plan',
  'Conclusion'
];

interface SectionSelectorProps {
  onSelect: (section: string) => void;
  usedSections?: string[];
}

const SectionSelector: React.FC<SectionSelectorProps> = ({ onSelect, usedSections = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customSection, setCustomSection] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleSelectSection = (section: string) => {
    onSelect(section);
    setIsOpen(false);
    setShowCustomInput(false);
    setCustomSection('');
  };

  const handleCustomSectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSection.trim()) {
      onSelect(customSection.trim());
      setCustomSection('');
      setShowCustomInput(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 text-left border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-green-500 flex justify-between items-center"
      >
        <span>Select section title</span>
        <svg 
          className={`h-5 w-5 text-gray-500 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 20 20" 
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg">
          <div className="max-h-60 overflow-auto py-1">
            {PREDEFINED_SECTIONS.map((section) => {
              const isUsed = usedSections.includes(section);
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => !isUsed && handleSelectSection(section)}
                  disabled={isUsed}
                  className={`w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center ${
                    isUsed ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <input 
                    type="checkbox" 
                    checked={isUsed} 
                    readOnly 
                    className="mr-2" 
                  />
                  {section}
                  {isUsed && <span className="ml-2 text-xs text-gray-500">(used)</span>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowCustomInput(true)}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 text-green-600 font-medium"
            >
              + Add Other Section
            </button>
          </div>
          
          {showCustomInput && (
            <form onSubmit={handleCustomSectionSubmit} className="p-2 border-t border-gray-200">
              <div className="flex">
                <input
                  type="text"
                  value={customSection}
                  onChange={(e) => setCustomSection(e.target.value)}
                  placeholder="Custom section name"
                  className="flex-1 px-3 py-1 border border-gray-300 rounded-l-md focus:outline-none focus:ring-1 focus:ring-green-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-3 py-1 bg-green-600 text-white rounded-r-md hover:bg-green-700"
                >
                  Add
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default SectionSelector; 