import React from 'react';
import { QuestLogo } from './QuestLogo';

/** The app icon on its tile, used on the sign-in screens. */
export const MagicalBookIcon: React.FC<{ className?: string }> = ({ className = "w-16 h-16" }) => {
  return <QuestLogo className={className} size={64} background="#2d2a45" />;
};
