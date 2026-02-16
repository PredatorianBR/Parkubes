
import React, { useState, useEffect, useRef } from 'react';

export const OnScreenControls: React.FC<{ visible: boolean }> = ({ visible }) => {
    const [isTouch, setIsTouch] = useState(false);
    const joystickRef = useRef<HTMLDivElement>(null);
    const activeKeys = useRef<Set<string>>(new Set());

    useEffect(() => {
        // Detect if we should show touch UI by default, 
        // but the request asked for clicks too, so we always show if visible
        setIsTouch('ontouchstart' in window);
    }, []);

    const dispatchKey = (key: string, down: boolean) => {
        const eventName = down ? 'game-control-down' : 'game-control-up';
        window.dispatchEvent(new CustomEvent(eventName, { detail: { key } }));
    };

    const handleJoystick = (e: React.MouseEvent | React.TouchEvent) => {
        if (!joystickRef.current) return;
        
        const rect = joystickRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 10) {
            clearJoystick();
            return;
        }

        const angle = Math.atan2(dy, dx);
        const newKeys = new Set<string>();

        // Isometric-friendly 8-way movement mapping
        if (angle > -Math.PI * 0.75 && angle < -Math.PI * 0.25) newKeys.add('w');
        if (angle > Math.PI * 0.25 && angle < Math.PI * 0.75) newKeys.add('s');
        if (angle > -Math.PI * 0.25 && angle < Math.PI * 0.25) newKeys.add('d');
        if (angle < -Math.PI * 0.75 || angle > Math.PI * 0.75) newKeys.add('a');

        // Update keys
        ['w', 'a', 's', 'd'].forEach(k => {
            if (newKeys.has(k) && !activeKeys.current.has(k)) {
                dispatchKey(k, true);
                activeKeys.current.add(k);
            } else if (!newKeys.has(k) && activeKeys.current.has(k)) {
                dispatchKey(k, false);
                activeKeys.current.delete(k);
            }
        });
    };

    const clearJoystick = () => {
        activeKeys.current.forEach(k => {
            if (['w', 'a', 's', 'd'].includes(k)) {
                dispatchKey(k, false);
            }
        });
        activeKeys.current.clear();
    };

    if (!visible) return null;

    return (
        <div className="absolute inset-0 pointer-events-none z-[45] select-none">
            {/* Joystick Area */}
            <div 
                ref={joystickRef}
                className="absolute bottom-10 left-10 w-40 h-40 bg-white/5 border-4 border-white/10 rounded-full pointer-events-auto backdrop-blur-sm flex items-center justify-center active:border-blue-500/50 transition-colors"
                onMouseDown={(e) => handleJoystick(e)}
                onMouseMove={(e) => e.buttons === 1 && handleJoystick(e)}
                onMouseUp={clearJoystick}
                onMouseLeave={clearJoystick}
                onTouchStart={(e) => handleJoystick(e)}
                onTouchMove={(e) => handleJoystick(e)}
                onTouchEnd={clearJoystick}
            >
                <div className="w-16 h-16 bg-white/20 border-4 border-white/20 rounded-full shadow-xl"></div>
                {/* Visual Indicators */}
                <div className="absolute top-2 pixel-font text-[8px] text-white/20">W</div>
                <div className="absolute bottom-2 pixel-font text-[8px] text-white/20">S</div>
                <div className="absolute left-2 pixel-font text-[8px] text-white/20">A</div>
                <div className="absolute right-2 pixel-font text-[8px] text-white/20">D</div>
            </div>

            {/* Action Buttons */}
            <div className="absolute bottom-10 right-10 flex flex-col gap-6 pointer-events-auto">
                <button 
                    className="w-24 h-24 bg-blue-600/40 border-4 border-blue-400/50 rounded-2xl backdrop-blur-md flex flex-col items-center justify-center active:bg-blue-500/80 active:scale-95 transition-all shadow-lg"
                    onMouseDown={() => dispatchKey(' ', true)}
                    onMouseUp={() => dispatchKey(' ', false)}
                    onMouseLeave={() => dispatchKey(' ', false)}
                    onTouchStart={(e) => { e.preventDefault(); dispatchKey(' ', true); }}
                    onTouchEnd={(e) => { e.preventDefault(); dispatchKey(' ', false); }}
                >
                    <div className="pixel-font text-[10px] text-white mb-2">PULAR</div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                </button>

                <button 
                    className="w-20 h-20 bg-yellow-600/30 border-4 border-yellow-400/40 rounded-2xl backdrop-blur-md flex flex-col items-center justify-center active:bg-yellow-500/80 active:scale-95 transition-all shadow-lg self-end"
                    onMouseDown={() => dispatchKey('shift', true)}
                    onMouseUp={() => dispatchKey('shift', false)}
                    onMouseLeave={() => dispatchKey('shift', false)}
                    onTouchStart={(e) => { e.preventDefault(); dispatchKey('shift', true); }}
                    onTouchEnd={(e) => { e.preventDefault(); dispatchKey('shift', false); }}
                >
                    <div className="pixel-font text-[8px] text-white mb-1">CORRER</div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="m13 3 3 3-3 3"/><path d="M16 6H3"/><path d="m13 15 3 3-3 3"/><path d="M16 18H3"/></svg>
                </button>
            </div>
        </div>
    );
};
