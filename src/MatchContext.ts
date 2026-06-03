import React from 'react';

export const MatchContext = React.createContext<{ timer: number }>({ timer: 0 });
