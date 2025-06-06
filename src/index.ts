console.log('BVtkNodes MCP Server starting...')

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

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
        bl_label: z.string().optional(),
        location: z.array(z.number()).optional(),
        properties: z.record(z.any()).optional(),
        connections: z.array(z.object({
            from_node: z.string(),
            from_socket: z.string(),
            to_node: z.string(),
            to_socket: z.string()
        })).optional()
    })),
    node_tree: z.object({
        name: z.string(),
        type: z.literal("BVTK_NodeTreeType").optional()
    }).optional()
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

// Helper function to generate Blender Python script
function generateBlenderScript(configData: any, outputPath?: string): string {
    const script = `
import bpy
import json
import os
from mathutils import Vector

# Enable BVtkNodes addon if not already enabled
if "BVtkNodes" not in bpy.context.preferences.addons:
    try:
        bpy.ops.preferences.addon_enable(module="BVtkNodes")
        print("BVtkNodes addon enabled")
    except:
        print("Failed to enable BVtkNodes addon - please ensure it's installed")
        exit(1)

# Import required modules
try:
    from BVtkNodes import tree
    from BVtkNodes.core import *
    print("BVtkNodes modules imported successfully")
except ImportError as e:
    print(f"Failed to import BVtkNodes modules: {e}")
    exit(1)

def create_bvtk_node_tree(config_data):
    """Create BVTK node tree from configuration data"""
    
    # Create new node tree
    tree_name = config_data.get('node_tree', {}).get('name', 'BVtkNodes_Tree')
    if tree_name in bpy.data.node_groups:
        bpy.data.node_groups.remove(bpy.data.node_groups[tree_name])
    
    node_tree = bpy.data.node_groups.new(tree_name, 'BVTK_NodeTreeType')
    
    # Dictionary to store created nodes for connection mapping
    created_nodes = {}
    
    # Create nodes
    for node_config in config_data.get('nodes', []):
        bl_idname = node_config['bl_idname']
        
        try:
            # Create node
            node = node_tree.nodes.new(bl_idname)
            node_name = node_config.get('bl_label', node.bl_label)
            
            # Set location if provided
            if 'location' in node_config:
                node.location = Vector(node_config['location'])
            
            # Set properties if provided
            if 'properties' in node_config:
                for prop_name, prop_value in node_config['properties'].items():
                    if hasattr(node, prop_name):
                        try:
                            setattr(node, prop_name, prop_value)
                        except Exception as e:
                            print(f"Failed to set property {prop_name}: {e}")
            
            created_nodes[node_name] = node
            print(f"Created node: {node_name} ({bl_idname})")
            
        except Exception as e:
            print(f"Failed to create node {bl_idname}: {e}")
    
    # Create connections
    for node_config in config_data.get('nodes', []):
        if 'connections' in node_config:
            node_name = node_config.get('bl_label', node_config['bl_idname'])
            
            for connection in node_config['connections']:
                try:
                    from_node_name = connection['from_node']
                    to_node_name = connection['to_node']
                    from_socket = connection['from_socket']
                    to_socket = connection['to_socket']
                    
                    if from_node_name in created_nodes and to_node_name in created_nodes:
                        from_node = created_nodes[from_node_name]
                        to_node = created_nodes[to_node_name]
                        
                        # Find sockets by name
                        from_sock = None
                        to_sock = None
                        
                        for sock in from_node.outputs:
                            if sock.name == from_socket:
                                from_sock = sock
                                break
                        
                        for sock in to_node.inputs:
                            if sock.name == to_socket:
                                to_sock = sock
                                break
                        
                        if from_sock and to_sock:
                            node_tree.links.new(from_sock, to_sock)
                            print(f"Connected {from_node_name}.{from_socket} -> {to_node_name}.{to_socket}")
                        else:
                            print(f"Failed to find sockets for connection: {from_node_name}.{from_socket} -> {to_node_name}.{to_socket}")
                
                except Exception as e:
                    print(f"Failed to create connection: {e}")
    
    print(f"Node tree '{tree_name}' created successfully with {len(created_nodes)} nodes")
    return node_tree

# Load configuration data
config_data = ${JSON.stringify(configData, null, 2)}

# Create the node tree
try:
    node_tree = create_bvtk_node_tree(config_data)
    
    # Switch to Shader Editor and set the node tree
    for area in bpy.context.screen.areas:
        if area.type == 'NODE_EDITOR':
            for space in area.spaces:
                if space.type == 'NODE_EDITOR':
                    space.tree_type = 'BVTK_NodeTreeType'
                    space.node_tree = node_tree
                    break
    
    print("BVtkNodes configuration imported successfully!")
    
    # Save blend file if output path provided
    ${outputPath ? `bpy.ops.wm.save_as_mainfile(filepath="${outputPath}")` : ''}
    
except Exception as e:
    print(f"Error importing BVtkNodes configuration: {e}")
    exit(1)
`;

    return script;
}

// Tool: Import JSON configuration to Blender
server.tool(
    "import-bvtk-config",
    "Import JSON configuration to Blender BVtkNodes",
    {
        json_file_path: z.string().describe("Path to the JSON configuration file"),
        blender_executable: z.string().optional().describe("Path to Blender executable (optional, will try to find automatically)"),
        output_blend_file: z.string().optional().describe("Path to save the resulting .blend file (optional)"),
        background_mode: z.boolean().optional().default(true).describe("Run Blender in background mode")
    },
    async ({ json_file_path, blender_executable, output_blend_file, background_mode }) => {
        try {
            // Check if JSON file exists
            if (!fs.existsSync(json_file_path)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: JSON file not found at path: ${json_file_path}`
                        }
                    ]
                };
            }

            // Read and validate JSON configuration
            const jsonContent = fs.readFileSync(json_file_path, 'utf8');
            let configData;

            try {
                configData = JSON.parse(jsonContent);
            } catch (parseError) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Invalid JSON format in file: ${json_file_path}\n${parseError}`
                        }
                    ]
                };
            }

            // Validate configuration structure
            if (!validateBVtkConfig(configData)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: JSON configuration does not match expected BVtkNodes format"
                        }
                    ]
                };
            }

            // Find Blender executable if not provided
            if (!blender_executable) {
                const possiblePaths = [
                    'blender',
                    '/Applications/Blender.app/Contents/MacOS/Blender',
                    'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
                    '/usr/bin/blender',
                    '/snap/bin/blender'
                ];

                for (const path of possiblePaths) {
                    try {
                        await execAsync(`${path} --version`);
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
                                text: "Error: Could not find Blender executable. Please provide the path manually."
                            }
                        ]
                    };
                }
            }

            // Generate Blender Python script
            const pythonScript = generateBlenderScript(configData, output_blend_file);
            const tempScriptPath = path.join(__dirname, 'temp_import_script.py');
            fs.writeFileSync(tempScriptPath, pythonScript);

            // Build Blender command
            const blenderArgs = [
                background_mode ? '--background' : '',
                '--python', tempScriptPath,
                '--python-exit-code', '1'
            ].filter(arg => arg !== '');

            const command = `"${blender_executable}" ${blenderArgs.join(' ')}`;

            // Execute Blender with the import script
            const { stdout, stderr } = await execAsync(command);

            // Clean up temporary script
            fs.unlinkSync(tempScriptPath);

            return {
                content: [
                    {
                        type: "text",
                        text: `BVtkNodes configuration imported successfully!\n\nBlender Output:\n${stdout}\n${stderr ? `Errors:\n${stderr}` : ''}`
                    }
                ]
            };

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error importing BVtkNodes configuration: ${error}`
                    }
                ]
            };
        }
    }
);

// Tool: Validate JSON configuration
server.tool(
    "validate-bvtk-config",
    "Validate JSON configuration for BVtkNodes",
    {
        json_file_path: z.string().describe("Path to the JSON configuration file to validate")
    },
    async ({ json_file_path }) => {
        try {
            if (!fs.existsSync(json_file_path)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: JSON file not found at path: ${json_file_path}`
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
                            text: `Error: Invalid JSON format\n${parseError}`
                        }
                    ]
                };
            }

            const isValid = validateBVtkConfig(configData);

            if (isValid) {
                const nodeCount = configData.nodes ? configData.nodes.length : 0;
                const connectionCount = configData.nodes ?
                    configData.nodes.reduce((total: any, node: { connections: string | any[]; }) => total + (node.connections ? node.connections.length : 0), 0) : 0;

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ JSON configuration is valid!\n\nSummary:\n- Nodes: ${nodeCount}\n- Connections: ${connectionCount}\n- Tree name: ${configData.node_tree?.name || 'Default'}`
                        }
                    ]
                };
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: "❌ JSON configuration is invalid. Please check the structure matches BVtkNodes format."
                        }
                    ]
                };
            }

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error validating configuration: ${error}`
                    }
                ]
            };
        }
    }
);

// Tool: Generate sample BVtkNodes configuration
server.tool(
    "generate-sample-config",
    "Generate a sample BVtkNodes JSON configuration",
    {
        output_path: z.string().optional().describe("Path to save the sample configuration (optional)")
    },
    async ({ output_path }) => {
        const sampleConfig = {
            node_tree: {
                name: "Sample_BVtkNodes_Tree",
                type: "BVTK_NodeTreeType"
            },
            nodes: [
                {
                    bl_idname: "BVTK_Node_vtkSphereSourceType",
                    bl_label: "Sphere Source",
                    location: [0, 0],
                    properties: {
                        m_Radius: 1.0,
                        m_ThetaResolution: 16,
                        m_PhiResolution: 16
                    }
                },
                {
                    bl_idname: "BVTK_Node_ColorMapperType",
                    bl_label: "Color Mapper",
                    location: [300, 0],
                    properties: {
                        texture_name: "ColorMap"
                    }
                },
                {
                    bl_idname: "BVTK_Node_VTKToBlenderMeshType",
                    bl_label: "VTK To Blender",
                    location: [600, 0],
                    properties: {
                        ob_name: "sphere_mesh"
                    }
                }
            ]
        };

        try {
            const configJson = JSON.stringify(sampleConfig, null, 2);

            if (output_path) {
                fs.writeFileSync(output_path, configJson);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Sample BVtkNodes configuration saved to: ${output_path}\n\nConfiguration:\n${configJson}`
                        }
                    ]
                };
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Sample BVtkNodes configuration:\n\n${configJson}`
                        }
                    ]
                };
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error generating sample configuration: ${error}`
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