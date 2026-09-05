#!/bin/bash
sed -i 's/{activeGame && (/{activeGame \&\& (<>/g' src/components/HeaderBar.tsx
sed -i 's/        )}/        )<\/>)}/g' src/components/HeaderBar.tsx
