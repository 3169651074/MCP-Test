console.log('BVtkNodes MCP Server starting...');
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
const execAsync = promisify(exec);
// Create server instance
const server = new McpServer({
    name: "bvtknodes-importer",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
// Helper function to get user desktop path
function getUserDesktopPath() {
    const homeDir = os.homedir();
    const platform = os.platform();
    switch (platform) {
        case 'win32':
            return path.join(homeDir, 'Desktop');
        case 'darwin':
            return path.join(homeDir, 'Desktop');
        case 'linux':
            return path.join(homeDir, 'Desktop');
        default:
            return path.join(homeDir, 'Desktop');
    }
}
// Helper function to generate the enhanced Blender import script with blend file saving
function generateBlenderImportScript(jsonFilePath, nodeTreeName, clearExisting = true, saveBlendFile = "") {
    // 根据操作系统格式化路径
    const formattedPath = os.platform() === 'win32'
        ? jsonFilePath.replace(/\\/g, '\\\\')
        : jsonFilePath;
    const formattedSavePath = saveBlendFile && os.platform() === 'win32'
        ? saveBlendFile.replace(/\\/g, '\\\\')
        : saveBlendFile;
    return `"""
BVtkNodes JSON 导入脚本 - 由 MCP 服务器生成
增强版本：包含自动保存功能
"""

import bpy
import json
import os

# 配置区域 - 由 MCP 服务器自动生成
JSON_FILE_PATH = "${formattedPath}"
NODE_TREE_NAME = "${nodeTreeName}"
CLEAR_EXISTING = True
SAVE_BLEND_FILE = "${formattedSavePath}"

def import_vtk_json():
    """导入 VTK 节点 JSON 文件"""

    # 检查文件是否存在
    if not os.path.exists(JSON_FILE_PATH):
        print(f"错误: 文件不存在 - {JSON_FILE_PATH}")
        return False

    try:
        # 确保BVtkNodes插件已启用
        if "BVtkNodes" not in bpy.context.preferences.addons:
            try:
                bpy.ops.preferences.addon_enable(module="BVtkNodes")
                print("已启用 BVtkNodes 插件")
            except Exception as e:
                print(f"无法启用 BVtkNodes 插件: {e}")
                return False

        # 导入 BVtkNodes 模块
        from BVtkNodes.tree import insert_into_node_tree
        from BVtkNodes.cache import BVTKCache

        # 读取 JSON 文件
        with open(JSON_FILE_PATH, 'r', encoding='utf-8') as f:
            json_data = json.load(f)

        print(f"读取 JSON 文件: {JSON_FILE_PATH}")
        print(f"节点数量: {len(json_data.get('nodes', []))}")
        print(f"连接数量: {len(json_data.get('links', []))}")

        # 清空现有场景（可选）
        # bpy.ops.wm.read_factory_settings(use_empty=True)

        # 获取或创建节点树
        if NODE_TREE_NAME in bpy.data.node_groups:
            node_tree = bpy.data.node_groups[NODE_TREE_NAME]
            print(f"使用现有节点树: {NODE_TREE_NAME}")
        else:
            node_tree = bpy.data.node_groups.new(NODE_TREE_NAME, "BVTK_NodeTreeType")
            print(f"创建新节点树: {NODE_TREE_NAME}")

        # 保存并设置更新模式
        original_mode = bpy.context.scene.bvtknodes_settings.update_mode
        bpy.context.scene.bvtknodes_settings.update_mode = "no-automatic-updates"
        print(f"原始更新模式: {original_mode}")

        # 清空现有节点
        if CLEAR_EXISTING:
            node_tree.nodes.clear()
            print("已清空现有节点")

        # 导入节点
        print("开始导入节点...")
        insert_into_node_tree(node_tree, json_data["nodes"], json_data["links"])
        print("节点导入完成")

        # 恢复更新模式并更新
        bpy.context.scene.bvtknodes_settings.update_mode = original_mode
        if original_mode == "update-all":
            BVTKCache.update_all()
            print("已更新所有缓存")

        # 标记场景为已修改
        bpy.context.blend_data.is_dirty = True
        
        # 自动保存 blend 文件
        if SAVE_BLEND_FILE:
            try:
                # 确保保存目录存在
                save_dir = os.path.dirname(SAVE_BLEND_FILE)
                if save_dir and not os.path.exists(save_dir):
                    os.makedirs(save_dir)
                
                bpy.ops.wm.save_as_mainfile(filepath=SAVE_BLEND_FILE)
                print(f"已保存 blend 文件: {SAVE_BLEND_FILE}")
            except Exception as e:
                print(f"保存 blend 文件失败: {e}")

        print(f"成功导入到节点树: {NODE_TREE_NAME}")
        print("导入过程完成！")
        
        # 输出节点树信息用于验证
        print(f"节点树 '{NODE_TREE_NAME}' 包含 {len(node_tree.nodes)} 个节点")
        for i, node in enumerate(node_tree.nodes):
            print(f"  节点 {i+1}: {node.name} ({node.bl_idname})")
        
        return True

    except ImportError as e:
        print(f"错误: BVtkNodes 插件未安装或未启用 - {str(e)}")
        return False
    except Exception as e:
        print(f"导入失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


# 执行导入
if __name__ == "__main__":
    print("开始执行 BVtkNodes 导入脚本...")
    result = import_vtk_json()
    if result:
        print("脚本执行成功！")
        exit(0)
    else:
        print("脚本执行失败！")
        exit(1)
`;
}
// Tool: Import JSON configuration to Blender using enhanced script
server.tool("import-bvtk-config", "Import JSON configuration to Blender BVtkNodes with automatic blend file saving", {
    json_filename: z.string().describe("JSON configuration filename (will be looked for on user's desktop)"),
    node_tree_name: z.string().optional().default("BVTK Node Tree").describe("Name for the node tree in Blender"),
    blender_executable: z.string().optional().describe("Path to Blender executable (optional, will try to find automatically)"),
    clear_existing: z.boolean().optional().default(true).describe("Whether to clear existing nodes in the tree"),
    background_mode: z.boolean().optional().default(false).describe("Run Blender in background mode (false for GUI mode)"),
    save_blend_file: z.boolean().optional().default(true).describe("Automatically save the blend file after import"),
    blend_filename: z.string().optional().describe("Custom blend filename (optional, will auto-generate if not provided)")
}, async ({ json_filename, node_tree_name, blender_executable, clear_existing, background_mode, save_blend_file, blend_filename }) => {
    try {
        // 构建完整的JSON文件路径（用户桌面）
        const desktopPath = getUserDesktopPath();
        const json_file_path = path.join(desktopPath, json_filename);
        // 检查JSON文件是否存在
        if (!fs.existsSync(json_file_path)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `错误: 在用户桌面未找到JSON文件: ${json_filename}\n完整路径: ${json_file_path}\n\n请确保文件存在于桌面上。`
                    }
                ]
            };
        }
        // 读取JSON配置（不进行格式验证，直接读取）
        const jsonContent = fs.readFileSync(json_file_path, 'utf8');
        let configData;
        try {
            configData = JSON.parse(jsonContent);
        }
        catch (parseError) {
            return {
                content: [
                    {
                        type: "text",
                        text: `错误: JSON文件格式无效: ${json_filename}\n错误信息: ${parseError}`
                    }
                ]
            };
        }
        // 生成 blend 文件保存路径
        let saveBlendPath = "";
        if (save_blend_file) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const defaultBlendName = blend_filename || `bvtk_import_${json_filename.replace('.json', '')}_${timestamp}.blend`;
            saveBlendPath = path.join(desktopPath, defaultBlendName);
        }
        // 查找Blender可执行文件
        if (!blender_executable) {
            const possiblePaths = [
                'blender',
                '/Applications/Blender.app/Contents/MacOS/Blender',
                'C:\\Program Files\\Blender Foundation\\Blender\\4.2\\blender.exe',
                'C:\\Program Files\\Blender Foundation\\Blender\\3.6\\blender.exe',
                'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
                '/usr/bin/blender',
                '/snap/bin/blender'
            ];
            for (const path of possiblePaths) {
                try {
                    await execAsync(`"${path}" --version`);
                    blender_executable = path;
                    break;
                }
                catch (error) {
                    continue;
                }
            }
            if (!blender_executable) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "错误: 无法找到Blender可执行文件。\n\n请手动指定Blender路径，或确保Blender已安装并在PATH中。\n\n常见位置:\n- Windows: C:\\Program Files\\Blender Foundation\\Blender\\[版本]\\blender.exe\n- macOS: /Applications/Blender.app/Contents/MacOS/Blender\n- Linux: /usr/bin/blender"
                        }
                    ]
                };
            }
        }
        // 生成增强的Blender Python脚本
        const pythonScript = generateBlenderImportScript(json_file_path, node_tree_name, clear_existing, saveBlendPath);
        const tempScriptPath = path.join(os.tmpdir(), `bvtk_import_${Date.now()}.py`);
        fs.writeFileSync(tempScriptPath, pythonScript);
        // 构建Blender命令
        const blenderArgs = [];
        if (background_mode) {
            blenderArgs.push('--background');
        }
        blenderArgs.push('--python', `"${tempScriptPath}"`);
        blenderArgs.push('--python-exit-code', '1');
        const command = `"${blender_executable}" ${blenderArgs.join(' ')}`;
        console.log(`执行命令: ${command}`);
        console.log(`运行模式: ${background_mode ? '后台模式' : 'GUI模式'}`);
        // 执行Blender导入脚本
        const { stdout, stderr } = await execAsync(command, {
            timeout: 120000, // 120秒超时（增加时间以处理GUI模式）
            maxBuffer: 2 * 1024 * 1024 // 2MB缓冲区
        });
        // 清理临时脚本
        try {
            fs.unlinkSync(tempScriptPath);
        }
        catch (cleanupError) {
            console.warn(`清理临时文件失败: ${cleanupError}`);
        }
        // 检查是否生成了blend文件
        const blendFileExists = save_blend_file && fs.existsSync(saveBlendPath);
        // 分析输出
        const nodeCount = configData.nodes ? configData.nodes.length : 0;
        const linkCount = configData.links ? configData.links.length : 0;
        let resultMessage = `🎉 BVtkNodes配置导入${blendFileExists ? '并保存' : ''}成功！\n\n`;
        resultMessage += `📁 JSON文件: ${json_filename}\n`;
        resultMessage += `🌲 节点树: ${node_tree_name}\n`;
        resultMessage += `📊 统计: ${nodeCount} 个节点, ${linkCount} 个连接\n`;
        resultMessage += `🖥️ 运行模式: ${background_mode ? '后台模式' : 'GUI模式'}\n`;
        if (blendFileExists) {
            const blendFileName = path.basename(saveBlendPath);
            resultMessage += `💾 已保存为: ${blendFileName}\n`;
        }
        resultMessage += `\n`;
        if (stdout) {
            resultMessage += `📝 Blender输出:\n${stdout}\n`;
        }
        if (stderr && !stderr.includes("Warning")) {
            resultMessage += `⚠️ 信息:\n${stderr}\n`;
        }
        if (!background_mode) {
            resultMessage += `\n💡 提示: Blender应该已在GUI模式下打开，请检查节点编辑器中的BVTKNode工作区域。`;
        }
        else if (blendFileExists) {
            resultMessage += `\n💡 提示: 请在Blender中打开保存的blend文件查看导入的节点。`;
        }
        return {
            content: [
                {
                    type: "text",
                    text: resultMessage
                }
            ]
        };
    }
    catch (error) {
        // 清理可能存在的临时文件
        try {
            const tempFiles = fs.readdirSync(os.tmpdir()).filter(file => file.startsWith('bvtk_import_'));
            tempFiles.forEach(file => {
                fs.unlinkSync(path.join(os.tmpdir(), file));
            });
        }
        catch (cleanupError) {
            // 忽略清理错误
        }
        return {
            content: [
                {
                    type: "text",
                    text: `❌ 导入BVtkNodes配置时发生错误:\n\n${error}\n\n请检查:\n1. Blender是否正确安装\n2. BVtkNodes插件是否已启用\n3. JSON文件格式是否正确\n4. 文件路径是否可访问\n\n建议尝试使用GUI模式 (background_mode: false) 来调试问题。`
                }
            ]
        };
    }
});
// Tool: Generate standalone import script
server.tool("generate-import-script", "Generate a standalone Python script for importing JSON to Blender (can be run manually)", {
    json_filename: z.string().describe("JSON configuration filename on user's desktop"),
    node_tree_name: z.string().optional().default("BVTK Node Tree").describe("Name for the node tree in Blender"),
    script_filename: z.string().optional().default("bvtk_import_script.py").describe("Filename for the generated script"),
    clear_existing: z.boolean().optional().default(true).describe("Whether to clear existing nodes in the tree")
}, async ({ json_filename, node_tree_name, script_filename, clear_existing }) => {
    try {
        const desktopPath = getUserDesktopPath();
        const json_file_path = path.join(desktopPath, json_filename);
        const script_output_path = path.join(desktopPath, script_filename);
        // 检查JSON文件是否存在
        if (!fs.existsSync(json_file_path)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `错误: 在用户桌面未找到JSON文件: ${json_filename}\n完整路径: ${json_file_path}`
                    }
                ]
            };
        }
        // 生成独立的Python脚本
        const pythonScript = generateBlenderImportScript(json_file_path, node_tree_name, clear_existing, "");
        fs.writeFileSync(script_output_path, pythonScript);
        return {
            content: [
                {
                    type: "text",
                    text: `✅ 独立导入脚本已生成！\n\n📁 脚本位置: ${script_output_path}\n📁 目标JSON: ${json_filename}\n🌲 节点树名称: ${node_tree_name}\n\n💡 使用方法:\n1. 打开Blender\n2. 切换到Scripting工作区\n3. 打开或粘贴生成的脚本\n4. 点击运行按钮\n\n这样您就可以手动执行导入过程，更容易调试问题。`
                }
            ]
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `❌ 生成导入脚本时发生错误: ${error}`
                }
            ]
        };
    }
});
// Keep other tools unchanged...
// Tool: Analyze JSON file structure (no validation, just analysis)
server.tool("analyze-bvtk-config", "Analyze JSON configuration structure for BVtkNodes (looks for file on user's desktop)", {
    json_filename: z.string().describe("JSON configuration filename on user's desktop to analyze")
}, async ({ json_filename }) => {
    try {
        const desktopPath = getUserDesktopPath();
        const json_file_path = path.join(desktopPath, json_filename);
        if (!fs.existsSync(json_file_path)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 错误: 在用户桌面未找到JSON文件: ${json_filename}\n完整路径: ${json_file_path}`
                    }
                ]
            };
        }
        const jsonContent = fs.readFileSync(json_file_path, 'utf8');
        let configData;
        try {
            configData = JSON.parse(jsonContent);
        }
        catch (parseError) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ JSON格式错误: ${json_filename}\n\n错误信息: ${parseError}`
                    }
                ]
            };
        }
        // 分析JSON结构而不验证
        let result = `📋 JSON配置文件分析: ${json_filename}\n\n`;
        // 基本信息
        const keys = Object.keys(configData);
        result += `🔑 顶级字段: ${keys.join(', ')}\n\n`;
        // 节点分析
        if (configData.nodes && Array.isArray(configData.nodes)) {
            const nodeCount = configData.nodes.length;
            result += `📊 节点信息:\n`;
            result += `  - 节点数量: ${nodeCount}\n`;
            if (nodeCount > 0) {
                // 分析节点类型
                const nodeTypes = [...new Set(configData.nodes.map((node) => node.bl_idname || node.type || '未知'))].sort();
                result += `  - 节点类型数: ${nodeTypes.length}\n`;
                result += `  - 节点类型: ${nodeTypes.join(', ')}\n\n`;
                // 节点详细统计
                result += `🔧 节点类型统计:\n`;
                nodeTypes.forEach(type => {
                    const count = configData.nodes.filter((node) => (node.bl_idname || node.type) === type).length;
                    result += `  - ${type}: ${count}个\n`;
                });
                result += `\n`;
            }
        }
        else {
            result += `❓ 未找到 'nodes' 数组字段\n\n`;
        }
        // 连接分析
        if (configData.links && Array.isArray(configData.links)) {
            const linkCount = configData.links.length;
            result += `🔗 连接信息:\n`;
            result += `  - 连接数量: ${linkCount}\n`;
            if (linkCount > 0 && configData.links[0]) {
                const linkKeys = Object.keys(configData.links[0]);
                result += `  - 连接字段: ${linkKeys.join(', ')}\n`;
            }
            result += `\n`;
        }
        else {
            result += `❓ 未找到 'links' 数组字段\n\n`;
        }
        // 文件大小信息
        const stats = fs.statSync(json_file_path);
        result += `📁 文件信息:\n`;
        result += `  - 文件大小: ${(stats.size / 1024).toFixed(1)} KB\n`;
        result += `  - 修改时间: ${stats.mtime.toLocaleString()}\n\n`;
        result += `✅ 分析完成！此文件将被直接传递给BVtkNodes导入脚本处理。`;
        return {
            content: [
                {
                    type: "text",
                    text: result
                }
            ]
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `❌ 分析配置时发生错误: ${error}`
                }
            ]
        };
    }
});
// Tool: List JSON files on desktop
server.tool("list-desktop-json-files", "List all JSON files on user's desktop", {}, async () => {
    try {
        const desktopPath = getUserDesktopPath();
        if (!fs.existsSync(desktopPath)) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 无法访问桌面路径: ${desktopPath}`
                    }
                ]
            };
        }
        const files = fs.readdirSync(desktopPath);
        const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json'));
        if (jsonFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `📁 桌面路径: ${desktopPath}\n\n没有找到JSON文件。\n\n您可以使用 generate-sample-config 工具生成示例配置文件。`
                    }
                ]
            };
        }
        let result = `📁 桌面路径: ${desktopPath}\n\n🔍 找到 ${jsonFiles.length} 个JSON文件:\n\n`;
        for (const file of jsonFiles) {
            const filePath = path.join(desktopPath, file);
            try {
                const stats = fs.statSync(filePath);
                const content = fs.readFileSync(filePath, 'utf8');
                const jsonData = JSON.parse(content);
                const hasNodes = jsonData.hasOwnProperty('nodes') && Array.isArray(jsonData.nodes);
                const hasLinks = jsonData.hasOwnProperty('links') && Array.isArray(jsonData.links);
                const nodeCount = jsonData.nodes ? jsonData.nodes.length : 0;
                const linkCount = jsonData.links ? jsonData.links.length : 0;
                result += `📄 ${file}\n`;
                result += `   大小: ${(stats.size / 1024).toFixed(1)} KB\n`;
                result += `   修改时间: ${stats.mtime.toLocaleString()}\n`;
                if (hasNodes) {
                    result += `   📊 包含 ${nodeCount} 个节点`;
                    if (hasLinks) {
                        result += `, ${linkCount} 个连接`;
                    }
                    result += `\n`;
                }
                else {
                    result += `   ❓ 未知格式\n`;
                }
                result += `\n`;
            }
            catch (error) {
                result += `📄 ${file}\n`;
                result += `   ❌ 无法读取或解析\n\n`;
            }
        }
        result += `💡 提示: 使用 analyze-bvtk-config 分析特定文件，或使用 import-bvtk-config 直接导入。`;
        return {
            content: [
                {
                    type: "text",
                    text: result
                }
            ]
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `❌ 列出桌面JSON文件时发生错误: ${error}`
                }
            ]
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("BVtkNodes MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
