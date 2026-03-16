import React, { useRef, useState } from 'react';
import { motion, useSpring } from 'framer-motion';

const Magnetic = ({ children, strength = 0.5 }) => {
    const ref = useRef(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    const mouseMove = (e) => {
        const { clientX, clientY } = e;
        const { width, height, left, top } = ref.current.getBoundingClientRect();
        const x = (clientX - (left + width / 2)) * strength;
        const y = (clientY - (top + height / 2)) * strength;
        setPosition({ x, y });
    };

    const mouseLeave = () => {
        setPosition({ x: 0, y: 0 });
    };

    const { x, y } = position;

    const springConfig = { damping: 20, stiffness: 150 };
    const springX = useSpring(x, springConfig);
    const springY = useSpring(y, springConfig);

    return (
        <motion.div
            ref={ref}
            onMouseMove={mouseMove}
            onMouseLeave={mouseLeave}
            style={{
                x: springX,
                y: springY,
            }}
        >
            {children}
        </motion.div>
    );
};

export default Magnetic;
