"""
BVtkNodes JSON 导入脚本
在 Blender 文本编辑器中直接运行

使用方法:
1. 修改下方的 JSON_FILE_PATH 为您的 JSON 文件路径
2. 在 Blender 文本编辑器中新建脚本并粘贴修改好的内容，或加载脚本后点击运行
3. 切换到BVTKNode工作区域，可以看到导入好的节点
"""

import bpy
import json
import os

# 配置区域 - 请修改以下路径
# Windows下，路径之间需要使用双反斜杠，Linux下使用一个正斜杠即可（绝对路径）
JSON_FILE_PATH = "your_json_file_absolute_path"

def import_vtk_json():
    """导入 VTK 节点 JSON 文件"""
    node_tree_name = "BVTK Node Tree"  # 节点树名称

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
        if node_tree_name in bpy.data.node_groups:
            node_tree = bpy.data.node_groups[node_tree_name]
        else:
            node_tree = bpy.data.node_groups.new(node_tree_name, "BVTK_NodeTreeType")

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
        node_tree.nodes.clear()

        # 导入节点
        insert_into_node_tree(node_tree, json_data["nodes"], json_data["links"])

        # 恢复更新模式并更新
        bpy.context.scene.bvtknodes_settings.update_mode = original_mode
        if original_mode == "update-all":
            BVTKCache.update_all()

        print(f"成功导入到节点树: {node_tree_name}")
        return True

    except ImportError:
        print("错误: BVtkNodes 插件未安装或未启用")
        return False
    except Exception as e:
        print(f"导入失败: {str(e)}")
        return False


# 执行导入
if __name__ == "__main__":
    import_vtk_json()