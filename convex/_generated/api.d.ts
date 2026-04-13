/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_instance from "../agent/instance.js";
import type * as agent_instructions from "../agent/instructions.js";
import type * as agent_modelResolver from "../agent/modelResolver.js";
import type * as api_playground from "../api/playground.js";
import type * as api_telegram from "../api/telegram.js";
import type * as api_utils from "../api/utils.js";
import type * as config_botConfig from "../config/botConfig.js";
import type * as config_env from "../config/env.js";
import type * as config_initial from "../config/initial.js";
import type * as crons from "../crons.js";
import type * as dailyCheck_actions from "../dailyCheck/actions.js";
import type * as dev_actions from "../dev/actions.js";
import type * as executor_action from "../executor/action.js";
import type * as executor_daytona from "../executor/daytona.js";
import type * as executor_db from "../executor/db.js";
import type * as executor_ipc from "../executor/ipc.js";
import type * as executor_types from "../executor/types.js";
import type * as files_db from "../files/db.js";
import type * as http from "../http.js";
import type * as llmCalls_actions from "../llmCalls/actions.js";
import type * as llmCalls_query from "../llmCalls/query.js";
import type * as memory_compaction from "../memory/compaction.js";
import type * as memory_db from "../memory/db.js";
import type * as memory_index from "../memory/index.js";
import type * as memory_searchTool from "../memory/searchTool.js";
import type * as memory_tool from "../memory/tool.js";
import type * as polling_actions from "../polling/actions.js";
import type * as polling_extractors from "../polling/extractors.js";
import type * as provisioning_db from "../provisioning/db.js";
import type * as provisioning_deployKeyParser from "../provisioning/deployKeyParser.js";
import type * as provisioning_githubApi from "../provisioning/githubApi.js";
import type * as provisioning_polling from "../provisioning/polling.js";
import type * as provisioning_provision from "../provisioning/provision.js";
import type * as provisioning_sourcePackager from "../provisioning/sourcePackager.js";
import type * as provisioning_workflowTemplate from "../provisioning/workflowTemplate.js";
import type * as sessions_actions from "../sessions/actions.js";
import type * as sessions_activityStorage from "../sessions/activityStorage.js";
import type * as sessions_db from "../sessions/db.js";
import type * as sessions_sessionEventHandlerAgent from "../sessions/sessionEventHandlerAgent.js";
import type * as sessions_sessionManager from "../sessions/sessionManager.js";
import type * as sessions_sessionManagerAgent from "../sessions/sessionManagerAgent.js";
import type * as sessions_storageActions from "../sessions/storageActions.js";
import type * as staticHosting from "../staticHosting.js";
import type * as tasks from "../tasks.js";
import type * as telegram_typingHeartbeat from "../telegram/typingHeartbeat.js";
import type * as tools_exa_search from "../tools/exa_search.js";
import type * as tools_executor from "../tools/executor.js";
import type * as tools_index from "../tools/index.js";
import type * as tools_nodeActions from "../tools/nodeActions.js";
import type * as tools_reportToOrchestrator from "../tools/reportToOrchestrator.js";
import type * as tools_selfBuild from "../tools/selfBuild.js";
import type * as types_index from "../types/index.js";
import type * as updater_actions from "../updater/actions.js";
import type * as updater_fetch from "../updater/fetch.js";
import type * as updater_types from "../updater/types.js";
import type * as users_actions from "../users/actions.js";
import type * as users_db from "../users/db.js";
import type * as utils_logger from "../utils/logger.js";
import type * as utils_retry from "../utils/retry.js";
import type * as utils_telegramFormat from "../utils/telegramFormat.js";
import type * as vfs_actions from "../vfs/actions.js";
import type * as vfs_db from "../vfs/db.js";
import type * as vfs_index from "../vfs/index.js";
import type * as vfs_pathUtils from "../vfs/pathUtils.js";
import type * as vfs_resolver from "../vfs/resolver.js";
import type * as vfs_tools from "../vfs/tools.js";
import type * as vfs_types from "../vfs/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/instance": typeof agent_instance;
  "agent/instructions": typeof agent_instructions;
  "agent/modelResolver": typeof agent_modelResolver;
  "api/playground": typeof api_playground;
  "api/telegram": typeof api_telegram;
  "api/utils": typeof api_utils;
  "config/botConfig": typeof config_botConfig;
  "config/env": typeof config_env;
  "config/initial": typeof config_initial;
  crons: typeof crons;
  "dailyCheck/actions": typeof dailyCheck_actions;
  "dev/actions": typeof dev_actions;
  "executor/action": typeof executor_action;
  "executor/daytona": typeof executor_daytona;
  "executor/db": typeof executor_db;
  "executor/ipc": typeof executor_ipc;
  "executor/types": typeof executor_types;
  "files/db": typeof files_db;
  http: typeof http;
  "llmCalls/actions": typeof llmCalls_actions;
  "llmCalls/query": typeof llmCalls_query;
  "memory/compaction": typeof memory_compaction;
  "memory/db": typeof memory_db;
  "memory/index": typeof memory_index;
  "memory/searchTool": typeof memory_searchTool;
  "memory/tool": typeof memory_tool;
  "polling/actions": typeof polling_actions;
  "polling/extractors": typeof polling_extractors;
  "provisioning/db": typeof provisioning_db;
  "provisioning/deployKeyParser": typeof provisioning_deployKeyParser;
  "provisioning/githubApi": typeof provisioning_githubApi;
  "provisioning/polling": typeof provisioning_polling;
  "provisioning/provision": typeof provisioning_provision;
  "provisioning/sourcePackager": typeof provisioning_sourcePackager;
  "provisioning/workflowTemplate": typeof provisioning_workflowTemplate;
  "sessions/actions": typeof sessions_actions;
  "sessions/activityStorage": typeof sessions_activityStorage;
  "sessions/db": typeof sessions_db;
  "sessions/sessionEventHandlerAgent": typeof sessions_sessionEventHandlerAgent;
  "sessions/sessionManager": typeof sessions_sessionManager;
  "sessions/sessionManagerAgent": typeof sessions_sessionManagerAgent;
  "sessions/storageActions": typeof sessions_storageActions;
  staticHosting: typeof staticHosting;
  tasks: typeof tasks;
  "telegram/typingHeartbeat": typeof telegram_typingHeartbeat;
  "tools/exa_search": typeof tools_exa_search;
  "tools/executor": typeof tools_executor;
  "tools/index": typeof tools_index;
  "tools/nodeActions": typeof tools_nodeActions;
  "tools/reportToOrchestrator": typeof tools_reportToOrchestrator;
  "tools/selfBuild": typeof tools_selfBuild;
  "types/index": typeof types_index;
  "updater/actions": typeof updater_actions;
  "updater/fetch": typeof updater_fetch;
  "updater/types": typeof updater_types;
  "users/actions": typeof users_actions;
  "users/db": typeof users_db;
  "utils/logger": typeof utils_logger;
  "utils/retry": typeof utils_retry;
  "utils/telegramFormat": typeof utils_telegramFormat;
  "vfs/actions": typeof vfs_actions;
  "vfs/db": typeof vfs_db;
  "vfs/index": typeof vfs_index;
  "vfs/pathUtils": typeof vfs_pathUtils;
  "vfs/resolver": typeof vfs_resolver;
  "vfs/tools": typeof vfs_tools;
  "vfs/types": typeof vfs_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  selfHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"selfHosting">;
};
