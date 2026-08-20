'use client';

/**
 * Read-only stand-in for a safety control on a SUPERVISED profile. The child
 * sees their current posture (visible on purpose — hiding it teaches
 * nothing) with a note that their guardian manages it. The server strips
 * these fields from self-service PUTs regardless; this is the honest UI half.
 */
export default function SupervisedSettingCard({
  icon,
  iconColor,
  label,
  description,
}: {
  icon: string;
  iconColor: string;
  label: string;
  description: string;
}) {
  return (
    <div className="w-full text-left p-4 rounded-lg border-2 border-border bg-surface-sunken">
      <div className="flex items-start gap-3">
        <i className={`fas ${icon} ${iconColor} mt-1`} aria-hidden="true"></i>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-primary">{label}</h4>
          <p className="text-sm text-tertiary">{description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <i className="fas fa-user-shield" aria-hidden="true"></i>
        <span>Managed by your guardian</span>
      </div>
    </div>
  );
}
