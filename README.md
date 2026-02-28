This is basic standerd MCP server example code

clone repo 

npm i

"serve:build": "tsc"    
    - to build 

"server:build:watch": "tsc --watch"   
    - it will watch your changes if changes made build again

"server:dev": "tsx src/server.ts"   
    - start server

"server:inspect": "set DANGEROUSLY_OMIT_AUTH=true && npx @modelcontextprotocol/inspector npm run server:dev"
    - IMP - to inspect the server