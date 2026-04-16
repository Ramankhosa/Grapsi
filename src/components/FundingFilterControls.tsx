import { useState, useEffect } from 'react';
import { FaFilter, FaGlobe, FaUniversity, FaMoneyBill, FaCalendarAlt } from 'react-icons/fa';

interface FilterControlsProps {
  onFilterChange: (filters: FilterOptions) => void;
  countryList?: string[];
  applicantTypesList?: string[];
  grantTypesList?: string[];
}

export interface FilterOptions {
  countries: string[];
  applicantTypes: string[];
  grantTypes: string[];
  includeExpired: boolean;
  limit: number;
}

const defaultCountries = [
  'USA', 'UK', 'Canada', 'Australia', 'India', 
  'Germany', 'France', 'Japan', 'China', 'Brazil'
];

const defaultApplicantTypes = [
  'Academic', 'Research Institution', 'Corporate', 'Non-Profit', 
  'NGO', 'Individual', 'Government', 'Startup'
];

const defaultGrantTypes = [
  'Research', 'Infrastructure', 'Travel', 'Publication', 
  'Conference', 'Seed', 'Equipment', 'Fellowship'
];

export default function FundingFilterControls({ 
  onFilterChange, 
  countryList = defaultCountries,
  applicantTypesList = defaultApplicantTypes,
  grantTypesList = defaultGrantTypes
}: FilterControlsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    countries: [],
    applicantTypes: [],
    grantTypes: [],
    includeExpired: false,
    limit: 5
  });

  // Notify parent component when filters change
  useEffect(() => {
    onFilterChange(filters);
  }, [filters, onFilterChange]);

  const handleCountryChange = (country: string) => {
    setFilters(prev => {
      const newCountries = prev.countries.includes(country)
        ? prev.countries.filter(c => c !== country)
        : [...prev.countries, country];
      
      return { ...prev, countries: newCountries };
    });
  };

  const handleApplicantTypeChange = (type: string) => {
    setFilters(prev => {
      const newTypes = prev.applicantTypes.includes(type)
        ? prev.applicantTypes.filter(t => t !== type)
        : [...prev.applicantTypes, type];
      
      return { ...prev, applicantTypes: newTypes };
    });
  };

  const handleGrantTypeChange = (type: string) => {
    setFilters(prev => {
      const newTypes = prev.grantTypes.includes(type)
        ? prev.grantTypes.filter(t => t !== type)
        : [...prev.grantTypes, type];
      
      return { ...prev, grantTypes: newTypes };
    });
  };

  const handleExpiredChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters(prev => ({ ...prev, includeExpired: e.target.checked }));
  };

  const handleLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters(prev => ({ ...prev, limit: parseInt(e.target.value) }));
  };

  const handleClearFilters = () => {
    setFilters({
      countries: [],
      applicantTypes: [],
      grantTypes: [],
      includeExpired: false,
      limit: 5
    });
  };

  const countActiveFilters = () => {
    return (
      filters.countries.length + 
      filters.applicantTypes.length + 
      filters.grantTypes.length + 
      (filters.includeExpired ? 1 : 0)
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg p-3 mb-4">
      <div className="flex justify-between items-center">
        <button 
          className="flex items-center text-white font-medium"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <FaFilter className="mr-2" />
          Filter Results
          {countActiveFilters() > 0 && (
            <span className="ml-2 bg-blue-600 text-white text-xs rounded-full px-2 py-1">
              {countActiveFilters()}
            </span>
          )}
        </button>

        {countActiveFilters() > 0 && (
          <button 
            className="text-xs text-gray-300 hover:text-white"
            onClick={handleClearFilters}
          >
            Clear All
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Country Filter */}
          <div>
            <div className="flex items-center text-gray-300 mb-2">
              <FaGlobe className="mr-2" />
              <h3 className="font-medium">Countries</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {countryList.map(country => (
                <button
                  key={country}
                  onClick={() => handleCountryChange(country)}
                  className={`text-xs px-2 py-1 rounded-full ${
                    filters.countries.includes(country) 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {country}
                </button>
              ))}
            </div>
          </div>

          {/* Applicant Type Filter */}
          <div>
            <div className="flex items-center text-gray-300 mb-2">
              <FaUniversity className="mr-2" />
              <h3 className="font-medium">Applicant Types</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {applicantTypesList.map(type => (
                <button
                  key={type}
                  onClick={() => handleApplicantTypeChange(type)}
                  className={`text-xs px-2 py-1 rounded-full ${
                    filters.applicantTypes.includes(type) 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Grant Type Filter */}
          <div>
            <div className="flex items-center text-gray-300 mb-2">
              <FaMoneyBill className="mr-2" />
              <h3 className="font-medium">Grant Types</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {grantTypesList.map(type => (
                <button
                  key={type}
                  onClick={() => handleGrantTypeChange(type)}
                  className={`text-xs px-2 py-1 rounded-full ${
                    filters.grantTypes.includes(type) 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Other Filters */}
          <div>
            <div className="flex items-center text-gray-300 mb-2">
              <FaCalendarAlt className="mr-2" />
              <h3 className="font-medium">Other Filters</h3>
            </div>
            
            <div className="flex items-center mb-2">
              <input
                type="checkbox"
                id="include-expired"
                checked={filters.includeExpired}
                onChange={handleExpiredChange}
                className="mr-2 rounded bg-gray-700 border-gray-600"
              />
              <label htmlFor="include-expired" className="text-gray-300 text-sm">
                Include Expired Calls
              </label>
            </div>
            
            <div className="flex items-center">
              <label htmlFor="result-limit" className="text-gray-300 text-sm mr-2">
                Results:
              </label>
              <select
                id="result-limit"
                value={filters.limit}
                onChange={handleLimitChange}
                className="bg-gray-700 text-gray-300 rounded px-2 py-1 text-sm border-gray-600"
              >
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 