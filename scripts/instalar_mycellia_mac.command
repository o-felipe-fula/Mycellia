#!/bin/bash
APP_NAME="Mycellia"
APP_PATH="/Applications/${APP_NAME}.app"

echo ""
echo "🍄 Instalador do ${APP_NAME}"
echo "-------------------------------"

if [ ! -d "$APP_PATH" ]; then
    echo ""
    echo "⚠️  ${APP_NAME}.app não encontrado em /Applications."
    echo ""
    echo "   Abra o arquivo .dmg e arraste o Mycellia para"
    echo "   a pasta Applications. Depois execute este"
    echo "   instalador novamente."
    echo ""
    read -p "   Pressione Enter para fechar..."
    exit 1
fi

echo ""
echo "🔓 Removendo restrição de segurança..."
xattr -cr "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Pronto! Abrindo o ${APP_NAME}..."
    echo ""
    open "$APP_PATH"
else
    echo ""
    echo "❌ Erro. Tente executar como administrador."
    read -p "   Pressione Enter para fechar..."
    exit 1
fi
