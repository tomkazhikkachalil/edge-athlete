'use client';

import { useState } from 'react';
import { X, RefreshCw, Archive } from 'lucide-react';
import AddEquipmentModal from './AddEquipmentModal';
import { type EquipmentItem } from './EquipmentSection';

interface ReplaceEquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  profileId: string;
  oldEquipment: EquipmentItem;
}

export default function ReplaceEquipmentModal({
  isOpen,
  onClose,
  onSuccess,
  profileId,
  oldEquipment,
}: ReplaceEquipmentModalProps) {
  const [step, setStep] = useState<'confirm' | 'add'>('confirm');
  const [retiring, setRetiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal closes
  const handleClose = () => {
    setStep('confirm');
    setError(null);
    onClose();
  };

  // Retire old equipment and proceed to add new
  const handleConfirmReplace = async () => {
    try {
      setRetiring(true);
      setError(null);

      // Retire the old equipment
      const response = await fetch(`/api/equipment/${oldEquipment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'retired' }),
      });

      if (!response.ok) {
        throw new Error('Failed to retire equipment');
      }

      // Move to add new equipment step
      setStep('add');
    } catch (err) {
      console.error('Error retiring equipment:', err);
      setError('Failed to retire equipment. Please try again.');
    } finally {
      setRetiring(false);
    }
  };

  // Handle successful addition of new equipment
  const handleAddSuccess = () => {
    onSuccess(); // Refresh equipment list
    handleClose(); // Close modal
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Confirmation step */}
      {step === 'confirm' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Replace Equipment</h2>
                  <p className="text-sm text-gray-500">Retire old gear and add new</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Old equipment preview */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Archive className="w-4 h-4" />
                  Equipment to retire:
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start gap-4">
                    {/* Image */}
                    {oldEquipment.image_url ? (
                      <img
                        src={oldEquipment.image_url}
                        alt={`${oldEquipment.brand} ${oldEquipment.model}`}
                        className="w-20 h-20 object-contain rounded-lg bg-white"
                      />
                    ) : (
                      <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center text-3xl">
                        🏌️
                      </div>
                    )}

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {oldEquipment.category.replace('_', ' ')}
                      </p>
                      <h3 className="text-lg font-bold text-gray-900 mt-1">
                        {oldEquipment.brand}
                      </h3>
                      <p className="text-base font-semibold text-gray-700">
                        {oldEquipment.model}
                      </p>
                      {oldEquipment.specs && Object.keys(oldEquipment.specs).length > 0 && (
                        <div className="mt-2 space-y-1">
                          {Object.entries(oldEquipment.specs)
                            .filter(([, value]) => value)
                            .slice(0, 2)
                            .map(([key, value]) => (
                              <div key={key} className="flex items-center gap-2 text-xs">
                                <span className="text-gray-500 capitalize">
                                  {key.replace('_', ' ')}:
                                </span>
                                <span className="text-gray-900 font-semibold">{value}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Info message */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-900 mb-1">
                      What happens next?
                    </p>
                    <ul className="text-sm text-blue-700 space-y-1">
                      <li>• Your current equipment will be marked as "retired"</li>
                      <li>• It will remain in your equipment history</li>
                      <li>• You can add the new replacement equipment</li>
                      <li>• The category will be pre-selected for you</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-900">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3 rounded-b-2xl">
              <button
                onClick={handleClose}
                className="px-6 py-2.5 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                disabled={retiring}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReplace}
                disabled={retiring}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {retiring ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Retiring...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Continue to Add New
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add new equipment step */}
      {step === 'add' && (
        <AddEquipmentModal
          isOpen={true}
          onClose={handleClose}
          onSuccess={handleAddSuccess}
          profileId={profileId}
          defaultCategory={oldEquipment.category}
          defaultSport={oldEquipment.sport_key}
          replacingEquipment={{
            brand: oldEquipment.brand,
            model: oldEquipment.model,
          }}
        />
      )}
    </>
  );
}
