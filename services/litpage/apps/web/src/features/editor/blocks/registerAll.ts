// Registers every block renderer and database view. Any file named *.block.tsx (blocks) or *.view.tsx
// (database views) under src/features is picked up automatically — add new types without editing this file.
// Non-text blocks live in editor/blocks/*.block.tsx.
import './icons.tsx';
import './blocks.css';
import './TextBlocks.tsx';
import '../../database/DatabaseBlock.tsx';
import '../atoms.ts';

import.meta.glob('../../**/*.block.tsx', { eager: true });
import.meta.glob('../../**/*.view.tsx', { eager: true });
