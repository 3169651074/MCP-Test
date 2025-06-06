console.log('BVtkNodes MCP Server starting...')

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import * as fs from 'fs';
import * as path from 'path';
import {exec} from 'child_process';
import {promisify} from 'util';
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

// JSON schema for BVtkNodes configuration
const BVtkNodeConfigSchema = z.object({
    nodes: z.array(z.object({
        bl_idname: z.string(),
        name: z.string().optional(),
        location: z.array(z.number()).optional(),
        properties: z.record(z.any()).optional(),
    })),
    links: z.array(z.object({
        from_node: z.string(),
        from_socket: z.string(),
        to_node: z.string(),
        to_socket: z.string()
    })).optional()
});

// Helper function to validate JSON configuration
function validateBVtkConfig(jsonData: any): boolean {
    try {
        BVtkNodeConfigSchema.parse(jsonData);
        return true;
    } catch (error) {
        console.error("JSON validation error:", error);
        return false;
    }
}

// Helper function to get user desktop path
function getUserDesktopPath(): string {
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

// Helper function to generate the enhanced Blender import script
function generateBlenderImportScript(jsonFilePath: string, nodeTreeName: string, clearExisting: boolean = true): string {
    // 根据操作系统格式化路径
    const formattedPath = os.platform() === 'win32'
        ? jsonFilePath.replace(/\\/g, '\\\\')
        : jsonFilePath;

    return `"""
BVtkNodes JSON 导入脚本 - 由 MCP 服务器生成
"""

import bpy
import json
import os

# 配置区域 - 由 MCP 服务器自动生成
JSON_FILE_PATH = "${formattedPath}"
NODE_TREE_NAME = "${nodeTreeName}"
CLEAR_EXISTING = True

def import_vtk_json():
    """导入 VTK 节点 JSON 文件"""

    # 检查文件是否存在
    if not os.path.exists(JSON_FILE_PATH):
        print(f"错误: 文件不存在 - {JSON_FILE_PATH}")
        return False

    try:
        # 导入 BVtkNodes 模块
        from BVtkNodes.tree import insert_into_node_tree
        from BVtkNodes.cache import BVTKCache

        # 读取 JSON 文件
        with open(JSON_FILE_PATH, 'r', encoding='utf-8') as f:
            json_data = json.load(f)

        print(f"读取 JSON 文件: {JSON_FILE_PATH}")
        print(f"节点数量: {len(json_data.get('nodes', []))}")
        print(f"连接数量: {len(json_data.get('links', []))}")

        # 获取或创建节点树
        if NODE_TREE_NAME in bpy.data.node_groups:
            node_tree = bpy.data.node_groups[NODE_TREE_NAME]
        else:
            node_tree = bpy.data.node_groups.new(NODE_TREE_NAME, "BVTK_NodeTreeType")

        # 设置当前节点树
        for area in bpy.context.screen.areas:
            if area.type == 'NODE_EDITOR':
                for space in area.spaces:
                    if space.type == 'NODE_EDITOR':
                        space.tree_type = 'BVTK_NodeTreeType'
                        space.node_tree = node_tree
                        break
                break

        # 保存并设置更新模式
        original_mode = bpy.context.scene.bvtknodes_settings.update_mode
        bpy.context.scene.bvtknodes_settings.update_mode = "no-automatic-updates"

        # 清空现有节点
        if CLEAR_EXISTING:
            node_tree.nodes.clear()
            print("已清空现有节点")

        # 导入节点
        insert_into_node_tree(node_tree, json_data["nodes"], json_data["links"])

        # 恢复更新模式并更新
        bpy.context.scene.bvtknodes_settings.update_mode = original_mode
        if original_mode == "update-all":
            BVTKCache.update_all()

        print(f"成功导入到节点树: {NODE_TREE_NAME}")
        print("请切换到 BVTKNode 工作区域查看导入的节点")
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
    result = import_vtk_json()
    if not result:
        exit(1)
`;
}

// Tool: Import JSON configuration to Blender using enhanced script
server.tool(
    "import-bvtk-config",
    "Import JSON configuration to Blender BVtkNodes using enhanced import script",
    {
        json_filename: z.string().describe("JSON configuration filename (will be looked for on user's desktop)"),
        node_tree_name: z.string().optional().default("BVTK Node Tree").describe("Name for the node tree in Blender"),
        blender_executable: z.string().optional().describe("Path to Blender executable (optional, will try to find automatically)"),
        clear_existing: z.boolean().optional().default(true).describe("Whether to clear existing nodes in the tree"),
        background_mode: z.boolean().optional().default(true).describe("Run Blender in background mode")
    },
    async ({ json_filename, node_tree_name, blender_executable, clear_existing, background_mode }) => {
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

            // 读取并验证JSON配置
            const jsonContent = fs.readFileSync(json_file_path, 'utf8');
            let configData;

            try {
                configData = JSON.parse(jsonContent);
            } catch (parseError) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `错误: JSON文件格式无效: ${json_filename}\n错误信息: ${parseError}`
                        }
                    ]
                };
            }

            // 验证配置结构
            if (!validateBVtkConfig(configData)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `错误: JSON配置不符合预期的BVtkNodes格式: ${json_filename}\n\n请确保JSON包含 'nodes' 数组和可选的 'links' 数组。`
                        }
                    ]
                };
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
                    } catch (error) {
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
            const pythonScript = generateBlenderImportScript(json_file_path, node_tree_name, clear_existing);
            const tempScriptPath = path.join(os.tmpdir(), `bvtk_import_${Date.now()}.py`);
            fs.writeFileSync(tempScriptPath, pythonScript);

            // 构建Blender命令
            const blenderArgs = [
                background_mode ? '--background' : '',
                '--python', `"${tempScriptPath}"`,
                '--python-exit-code', '1'
            ].filter(arg => arg !== '');

            const command = `"${blender_executable}" ${blenderArgs.join(' ')}`;

            console.log(`执行命令: ${command}`);

            // 执行Blender导入脚本
            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000, // 60秒超时
                maxBuffer: 1024 * 1024 // 1MB缓冲区
            });

            // 清理临时脚本
            try {
                fs.unlinkSync(tempScriptPath);
            } catch (cleanupError) {
                console.warn(`清理临时文件失败: ${cleanupError}`);
            }

            // 分析输出
            const nodeCount = configData.nodes ? configData.nodes.length : 0;
            const linkCount = configData.links ? configData.links.length : 0;

            let resultMessage = `🎉 BVtkNodes配置导入成功！\n\n`;
            resultMessage += `📁 文件: ${json_filename}\n`;
            resultMessage += `🌲 节点树: ${node_tree_name}\n`;
            resultMessage += `📊 统计: ${nodeCount} 个节点, ${linkCount} 个连接\n\n`;

            if (stdout) {
                resultMessage += `📝 Blender输出:\n${stdout}\n`;
            }

            if (stderr && !stderr.includes("Warning")) {
                resultMessage += `⚠️ 警告信息:\n${stderr}\n`;
            }

            resultMessage += `\n💡 提示: 请在Blender中切换到BVTKNode工作区域查看导入的节点。`;

            return {
                content: [
                    {
                        type: "text",
                        text: resultMessage
                    }
                ]
            };

        } catch (error) {
            // 清理可能存在的临时文件
            try {
                const tempFiles = fs.readdirSync(os.tmpdir()).filter(file => file.startsWith('bvtk_import_'));
                tempFiles.forEach(file => {
                    fs.unlinkSync(path.join(os.tmpdir(), file));
                });
            } catch (cleanupError) {
                // 忽略清理错误
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 导入BVtkNodes配置时发生错误:\n\n${error}\n\n请检查:\n1. Blender是否正确安装\n2. BVtkNodes插件是否已启用\n3. JSON文件格式是否正确\n4. 文件路径是否可访问`
                    }
                ]
            };
        }
    }
);

// Tool: Validate JSON configuration with enhanced validation
server.tool(
    "validate-bvtk-config",
    "Validate JSON configuration for BVtkNodes (looks for file on user's desktop)",
    {
        json_filename: z.string().describe("JSON configuration filename on user's desktop to validate")
    },
    async ({ json_filename }) => {
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
            } catch (parseError) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ JSON格式错误: ${json_filename}\n\n错误信息: ${parseError}`
                        }
                    ]
                };
            }

            const isValid = validateBVtkConfig(configData);

            if (isValid) {
                const nodeCount = configData.nodes ? configData.nodes.length : 0;
                const linkCount = configData.links ? configData.links.length : 0;

                // 分析节点类型
                const nodeTypes = configData.nodes ?
                    [...new Set(configData.nodes.map((node: { bl_idname: any; }) => node.bl_idname))].sort() : [];

                let result = `✅ JSON配置验证通过！\n\n`;
                result += `📁 文件: ${json_filename}\n`;
                result += `📊 统计:\n`;
                result += `  - 节点数量: ${nodeCount}\n`;
                result += `  - 连接数量: ${linkCount}\n`;
                result += `  - 节点类型数: ${nodeTypes.length}\n\n`;

                if (nodeTypes.length > 0) {
                    result += `🔧 节点类型:\n`;
                    nodeTypes.forEach(type => {
                        const count = configData.nodes.filter((node: { bl_idname: unknown; }) => node.bl_idname === type).length;
                        result += `  - ${type}: ${count}个\n`;
                    });
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: result
                        }
                    ]
                };
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: `❌ JSON配置格式无效: ${json_filename}\n\n请确保JSON包含:\n- 'nodes' 数组 (必需)\n- 'links' 数组 (可选)\n\n每个节点应包含 'bl_idname' 字段。`
                        }
                    ]
                };
            }

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 验证配置时发生错误: ${error}`
                    }
                ]
            };
        }
    }
);

// Tool: Generate sample BVtkNodes configuration on desktop
server.tool(
    "generate-sample-config",
    "Generate a sample BVtkNodes JSON configuration and save to user's desktop",
    {
        filename: z.string().optional().default("sample_bvtk_config.json").describe("Filename for the sample configuration"),
        config_type: z.enum(["simple", "advanced", "particle_simulation"]).optional().default("simple").describe("Type of sample configuration to generate")
    },
    async ({ filename, config_type }) => {
        const desktopPath = getUserDesktopPath();
        const output_path = path.join(desktopPath, filename);

        let sampleConfig;

        switch (config_type) {
            case "simple":
                sampleConfig = {
                    nodes: [
                        {
                            bl_idname: "BVTK_Node_vtkSphereSourceType",
                            name: "Sphere Source",
                            location: [0, 200],
                            properties: {
                                m_Radius: 1.0,
                                m_ThetaResolution: 32,
                                m_PhiResolution: 32
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_VTKToBlenderMeshType",
                            name: "VTK To Blender",
                            location: [400, 200],
                            properties: {
                                ob_name: "sphere_mesh"
                            }
                        }
                    ],
                    links: [
                        {
                            from_node: "Sphere Source",
                            from_socket: "output",
                            to_node: "VTK To Blender",
                            to_socket: "input"
                        }
                    ]
                };
                break;

            case "advanced":
                sampleConfig = {
                    nodes: [
                        {
                            bl_idname: "BVTK_Node_vtkCylinderSourceType",
                            name: "Cylinder Source",
                            location: [0, 300],
                            properties: {
                                m_Height: 2.0,
                                m_Radius: 0.5,
                                m_Resolution: 16
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_vtkElevationFilterType",
                            name: "Elevation Filter",
                            location: [300, 300],
                            properties: {
                                m_LowPoint: [0.0, -1.0, 0.0],
                                m_HighPoint: [0.0, 1.0, 0.0]
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_ColorMapperType",
                            name: "Color Mapper",
                            location: [600, 300],
                            properties: {
                                texture_name: "ColorMap"
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_VTKToBlenderMeshType",
                            name: "VTK To Blender",
                            location: [900, 300],
                            properties: {
                                ob_name: "colored_cylinder"
                            }
                        }
                    ],
                    links: [
                        {
                            from_node: "Cylinder Source",
                            from_socket: "output",
                            to_node: "Elevation Filter",
                            to_socket: "input"
                        },
                        {
                            from_node: "Elevation Filter",
                            from_socket: "output",
                            to_node: "Color Mapper",
                            to_socket: "input"
                        },
                        {
                            from_node: "Color Mapper",
                            from_socket: "output",
                            to_node: "VTK To Blender",
                            to_socket: "input"
                        }
                    ]
                };
                break;

            case "particle_simulation":
                sampleConfig = {
                    nodes: [
                        {
                            bl_idname: "BVTK_Node_vtkPointSourceType",
                            name: "Point Source",
                            location: [0, 400],
                            properties: {
                                m_NumberOfPoints: 1000,
                                m_Radius: 2.0
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_vtkGlyphFilterType",
                            name: "Glyph Filter",
                            location: [300, 400],
                            properties: {
                                m_ScaleFactor: 0.1
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_vtkSphereSourceType",
                            name: "Glyph Sphere",
                            location: [0, 200],
                            properties: {
                                m_Radius: 0.05,
                                m_ThetaResolution: 8,
                                m_PhiResolution: 8
                            }
                        },
                        {
                            bl_idname: "BVTK_Node_VTKToBlenderMeshType",
                            name: "VTK To Blender",
                            location: [600, 400],
                            properties: {
                                ob_name: "particle_system"
                            }
                        }
                    ],
                    links: [
                        {
                            from_node: "Point Source",
                            from_socket: "output",
                            to_node: "Glyph Filter",
                            to_socket: "input"
                        },
                        {
                            from_node: "Glyph Sphere",
                            from_socket: "output",
                            to_node: "Glyph Filter",
                            to_socket: "source"
                        },
                        {
                            from_node: "Glyph Filter",
                            from_socket: "output",
                            to_node: "VTK To Blender",
                            to_socket: "input"
                        }
                    ]
                };
                break;
        }

        try {
            const configJson = JSON.stringify(sampleConfig, null, 2);
            fs.writeFileSync(output_path, configJson);

            const nodeCount = sampleConfig.nodes.length;
            const linkCount = sampleConfig.links.length;

            return {
                content: [
                    {
                        type: "text",
                        text: `✅ 示例BVtkNodes配置已生成！\n\n📁 保存位置: ${output_path}\n📊 统计: ${nodeCount} 个节点, ${linkCount} 个连接\n🎯 类型: ${config_type}\n\n现在您可以使用 import-bvtk-config 工具导入此配置到Blender中。`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 生成示例配置时发生错误: ${error}`
                    }
                ]
            };
        }
    }
);

// Tool: List JSON files on desktop
server.tool(
    "list-desktop-json-files",
    "List all JSON files on user's desktop that could be BVtkNodes configurations",
    {},
    async () => {
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

                    const isBVtkConfig = jsonData.hasOwnProperty('nodes') && Array.isArray(jsonData.nodes);
                    const nodeCount = jsonData.nodes ? jsonData.nodes.length : 0;
                    const linkCount = jsonData.links ? jsonData.links.length : 0;

                    result += `📄 ${file}\n`;
                    result += `   大小: ${(stats.size / 1024).toFixed(1)} KB\n`;
                    result += `   修改时间: ${stats.mtime.toLocaleString()}\n`;

                    if (isBVtkConfig) {
                        result += `   ✅ BVtkNodes配置 (${nodeCount} 节点, ${linkCount} 连接)\n`;
                    } else {
                        result += `   ❓ 未知格式\n`;
                    }
                    result += `\n`;

                } catch (error) {
                    result += `📄 ${file}\n`;
                    result += `   ❌ 无法读取或解析\n\n`;
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: result
                    }
                ]
            };

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ 列出桌面JSON文件时发生错误: ${error}`
                    }
                ]
            };
        }
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("BVtkNodes MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});