
import React, { useState, useRef } from 'react';

export const OnScreenControls: React.FC<{ visible: boolean }> = ({ visible }) => {
    const joystickRef = useRef<HTMLDivElement>(null);
    const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });

    const dispatchKey = (key: string, down: boolean) => {
        const eventName = down ? 'game-control-down' : 'game-control-up';
        window.dispatchEvent(new CustomEvent(eventName, { detail: { key } }));
    };

    const dispatchAnalog = (x: number, y: number) => {
        window.dispatchEvent(new CustomEvent('game-joystick-move', { detail: { x, y } }));
    };

    const dispatchAnalogEnd = () => {
        window.dispatchEvent(new CustomEvent('game-joystick-end'));
    };

    const handleJoystick = (e: React.MouseEvent | React.TouchEvent) => {
        if (!joystickRef.current) return;
        
        const rect = joystickRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const radius = rect.width / 2;
        
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
        
        // Normalize
        let nx = dx;
        let ny = dy;
        
        if (dist > radius) {
            const ratio = radius / dist;
            nx = dx * ratio;
            ny = dy * ratio;
        }

        // Visual Update
        setKnobPos({ x: nx, y: ny });

        // Logic Update (Normalized -1 to 1)
        dispatchAnalog(nx / radius, ny / radius);
    };

    const clearJoystick = () => {
        setKnobPos({ x: 0, y: 0 });
        dispatchAnalogEnd();
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
                <div 
                    className="w-16 h-16 bg-white/20 border-4 border-white/20 rounded-full shadow-xl absolute"
                    style={{ transform: `translate(${knobPos.x}px, ${knobPos.y}px)` }}
                ></div>
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
            </div>
        </div>
    );
};
