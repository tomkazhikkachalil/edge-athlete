'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSportDefinition, getSportAdapter } from '@/lib/sports';
import { getPlaceholder } from '@/lib/config';
import { COPY } from '@/lib/copy';
import { cssClasses } from '@/lib/design-tokens';

interface ActivityRow {
  id: string;
  col1: string;
  col2: string;
  col3: string;
  col4: string;
  col5?: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

interface MultiSportActivityProps {
  profileId: string;
  canEdit?: boolean;
  onEdit?: (sportKey: string, entityId?: string) => void;
  onDelete?: (sportKey: string, entityId: string) => void;
}

export default function MultiSportActivity({ profileId, onEdit, onDelete }: MultiSportActivityProps) {
  const [activeSportKey, setActiveSportKey] = useState('golf'); // Golf is default active
  const [activityData, setActivityData] = useState<Record<string, ActivityRow[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Primary sports to show as tabs
  const primarySportKeys = ['golf', 'ice_hockey', 'volleyball'];

  // Load activity data for a specific sport
  const loadSportActivity = useCallback(async (sportKey: string) => {
    try {
      setLoading(prev => ({ ...prev, [sportKey]: true }));

      const adapter = getSportAdapter(sportKey as any);
      const result = await adapter.getRecentActivity(profileId, 10);

      setActivityData(prev => ({
        ...prev,
        [sportKey]: result.rows
      }));
    } catch (_error) {
      // Error loading activity
      setActivityData(prev => ({
        ...prev,
        [sportKey]: []
      }));
    } finally {
      setLoading(prev => ({ ...prev, [sportKey]: false }));
    }
  }, [profileId]);

  // Load initial data for active sport
  useEffect(() => {
    if (profileId && activeSportKey) {
      loadSportActivity(activeSportKey);
    }
  }, [profileId, activeSportKey, loadSportActivity]);

  const handleTabChange = (sportKey: string) => {
    setActiveSportKey(sportKey);
    
    // Load data if not already loaded
    if (!activityData[sportKey] && !loading[sportKey]) {
      loadSportActivity(sportKey);
    }
  };

  const handleAddActivity = () => {
    const adapter = getSportAdapter(activeSportKey as any);

    if (adapter.isEnabled()) {
      onEdit?.(activeSportKey);
    } else {
      // Show "coming soon" message using centralized copy
      // Show coming soon message
    }
  };

  const handleEditActivity = (entityId: string) => {
    const adapter = getSportAdapter(activeSportKey as any);

    if (adapter.isEnabled()) {
      onEdit?.(activeSportKey, entityId);
    }
  };

  const handleDeleteActivity = (entityId: string) => {
    const adapter = getSportAdapter(activeSportKey as any);

    if (adapter.isEnabled()) {
      onDelete?.(activeSportKey, entityId);
    }
  };

  const renderTabButton = (sportKey: string) => {
    const sportDef = getSportDefinition(sportKey as any);
    const adapter = getSportAdapter(sportKey as any);
    const isActive = activeSportKey === sportKey;
    const isEnabled = adapter.isEnabled();
    
    return (
      <button
        key={sportKey}
        onClick={() => handleTabChange(sportKey)}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          isActive
            ? isEnabled
              ? 'bg-blue-100 text-blue-700 border border-blue-200'
              : 'bg-gray-100 text-gray-700 border border-gray-200'
            : isEnabled
              ? 'text-gray-500 hover:text-gray-700'
              : 'text-gray-400 cursor-not-allowed'
        }`}
        disabled={!isEnabled && !isActive}
        title={!isEnabled ? COPY.COMING_SOON.SPORT_GENERAL : undefined}
      >
        <div className="flex items-center space-x-2">
          <i className={`${sportDef.icon_id} text-sm`}></i>
          <span>{sportDef.activity_columns.col2}</span> {/* "Rounds", "Games", "Matches" */}
          {!isEnabled && <span className="text-xs">{COPY.TABS.COMING_SOON_INDICATOR}</span>}
        </div>
      </button>
    );
  };

  const renderActivityTable = () => {
    const sportDef = getSportDefinition(activeSportKey as any);
    const adapter = getSportAdapter(activeSportKey as any);
    const isEnabled = adapter.isEnabled();
    const rows = activityData[activeSportKey] || [];
    const isLoading = loading[activeSportKey];

    if (isLoading) {
      return (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading...</p>
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          <i className={`${sportDef.icon_id} icon-header text-gray-300 mb-3`}></i>
          <p className="mb-2">
            {isEnabled 
              ? getPlaceholder('NO_PERFORMANCES') 
              : `No ${sportDef.activity_columns.col2.toLowerCase()} yet`
            }
          </p>
          <p className="text-label mb-4">
            {isEnabled 
              ? `Add your ${sportDef.activity_columns.col2.toLowerCase()} to track progress!`
              : `${sportDef.display_name} ${sportDef.activity_columns.col2.toLowerCase()} coming soon!`
            }
          </p>
          {isEnabled && (
            <button
              onClick={handleAddActivity}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 transition-colors"
            >
              {sportDef.primary_action}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-micro py-micro text-left text-chip text-gray-500 uppercase tracking-wider">
                <div className="flex items-center space-x-1">
                  <span>{sportDef.activity_columns.col1}</span>
                  <i className="fas fa-chevron-down text-xs text-blue-600" title="Newest → Oldest"></i>
                </div>
              </th>
              <th className="px-micro py-micro text-left text-chip text-gray-500 uppercase tracking-wider">
                {sportDef.activity_columns.col2}
              </th>
              <th className="px-micro py-micro text-left text-chip text-gray-500 uppercase tracking-wider">
                {sportDef.activity_columns.col3}
              </th>
              <th className="px-micro py-micro text-left text-chip text-gray-500 uppercase tracking-wider">
                {sportDef.activity_columns.col4}
              </th>
              {sportDef.activity_columns.col5 && (
                <th className="px-micro py-micro text-left text-chip text-gray-500 uppercase tracking-wider">
                  {sportDef.activity_columns.col5}
                </th>
              )}
              <th className="px-micro py-micro text-right text-chip text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-micro py-micro whitespace-nowrap text-label text-gray-900">
                  {row.col1}
                </td>
                <td className="px-micro py-micro whitespace-nowrap text-label text-gray-900">
                  {row.col2}
                </td>
                <td className="px-micro py-micro whitespace-nowrap text-label text-gray-900">
                  {row.col3}
                </td>
                <td className="px-micro py-micro whitespace-nowrap text-label text-gray-900">
                  {row.col4}
                </td>
                {sportDef.activity_columns.col5 && (
                  <td className="px-4 py-2 whitespace-nowrap text-label text-gray-500">
                    {row.col5 || '—'}
                  </td>
                )}
                <td className="px-micro py-micro whitespace-nowrap text-right">
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => {
                        if (activeSportKey === 'golf' && adapter.isEnabled()) {
                          // Navigate to golf round detail
                          window.location.href = `/app/sport/golf/rounds/${row.id}`;
                        } else {
                          // For other sports, show coming soon
                          // Activity detail coming soon
                        }
                      }}
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                      title={adapter.isEnabled() ? `View ${sportDef.activity_columns.col2.slice(0, -1)} Details` : 'Coming soon'}
                    >
                      <i className={`fas ${adapter.isEnabled() ? 'fa-eye' : 'fa-clock'} icon-edit`}></i>
                    </button>
                    {row.canEdit && adapter.isEnabled() && (
                      <button
                        onClick={() => handleEditActivity(row.id)}
                        className="text-green-600 hover:text-green-800 transition-colors"
                        title={`Edit ${sportDef.activity_columns.col2.slice(0, -1)}`}
                      >
                        <i className="fas fa-edit icon-edit"></i>
                      </button>
                    )}
                    {row.canDelete && (
                      <button
                        onClick={() => handleDeleteActivity(row.id)}
                        className="text-red-600 hover:text-red-800 transition-colors"
                        title={`Delete ${sportDef.activity_columns.col2.slice(0, -1)}`}
                      >
                        <i className="fas fa-trash icon-edit"></i>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-base">
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${cssClasses.SPACING.MARGIN.BASE}`}>
        <div className="flex-1">
          <h2 className={`${cssClasses.TYPOGRAPHY.H2} text-gray-900`}>{COPY.NAVIGATION.RECENT_ACTIVITY}</h2>
          <p className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500 mt-1`}>
            <i className={`fas fa-sort-amount-down ${cssClasses.TYPOGRAPHY.CHIP} mr-1`}></i>
            {COPY.SORTING.NEWEST_OLDEST}
          </p>
        </div>
        
        {/* Add button for active sport */}
        <button
          onClick={handleAddActivity}
          className={`px-4 py-2 text-sm font-medium border border-transparent rounded-md transition-colors ${
            getSportAdapter(activeSportKey as any).isEnabled()
              ? 'text-white bg-blue-600 hover:bg-blue-700'
              : 'text-gray-500 bg-gray-100 cursor-not-allowed'
          }`}
          disabled={!getSportAdapter(activeSportKey as any).isEnabled()}
          title={getSportAdapter(activeSportKey as any).isEnabled() ? undefined : 'Coming soon'}
        >
          {getSportDefinition(activeSportKey as any).primary_action}
        </button>
      </div>

      {/* Sport Tabs */}
      <div className="flex space-x-2 mb-4">
        {primarySportKeys.map(sportKey => renderTabButton(sportKey))}
      </div>

      {/* Activity Table */}
      {renderActivityTable()}
    </div>
  );
}